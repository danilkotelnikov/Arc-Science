//! Catch a leaked real child when a wrapper fails after OS creation.
use arc_science_native::acquire;
use process_wrap::std::{ChildWrapper, CommandWrap, CommandWrapper};
#[cfg(unix)]
use std::sync::atomic::{AtomicU32, Ordering};
use std::{
    io,
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
};

#[cfg(unix)]
#[derive(Clone, Copy, Debug)]
enum Failure {
    PostSpawn,
    WrapChild,
}

#[cfg(unix)]
#[derive(Debug)]
struct FailingWrapper {
    stage: Failure,
    pid: Arc<AtomicU32>,
}

#[cfg(unix)]
impl CommandWrapper for FailingWrapper {
    fn post_spawn(
        &mut self,
        _: &mut Command,
        child: &mut Child,
        _: &CommandWrap,
    ) -> io::Result<()> {
        assert!(
            child.try_wait()?.is_none(),
            "fixture must still be alive at the failure boundary"
        );
        self.pid.store(child.id(), Ordering::SeqCst);
        if matches!(self.stage, Failure::PostSpawn) {
            Err(io::Error::other("injected post-spawn failure"))
        } else {
            Ok(())
        }
    }
    fn wrap_child(
        &mut self,
        _: Box<dyn ChildWrapper>,
        _: &CommandWrap,
    ) -> io::Result<Box<dyn ChildWrapper>> {
        Err(io::Error::other("injected child-wrapper failure"))
    }
}

fn command() -> Command {
    let python = std::env::var("ARC_NATIVE_TEST_PYTHON")
        .unwrap_or_else(|_| if cfg!(windows) { "python" } else { "python3" }.into());
    let mut command = Command::new(python);
    command
        .args(["-c", "import time; time.sleep(60)"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    command
}

#[cfg(unix)]
fn failure_reaps(stage: Failure) {
    use nix::{
        errno::Errno,
        sys::{
            signal::{Signal, kill},
            wait::{WaitPidFlag, WaitStatus, waitpid},
        },
        unistd::Pid,
    };
    let pid = Arc::new(AtomicU32::new(0));
    let error = acquire::spawn(
        command(),
        FailingWrapper {
            stage,
            pid: Arc::clone(&pid),
        },
    )
    .unwrap_err();
    assert!(error.to_string().contains("injected"));
    let pid = pid.load(Ordering::SeqCst);
    assert_ne!(pid, 0, "test must reach actual OS child creation");
    let pid = Pid::from_raw(pid as i32);
    let status = waitpid(pid, Some(WaitPidFlag::WNOHANG));
    // Test-only fallback prevents a failed RED from leaving a live fixture.
    if matches!(status, Ok(WaitStatus::StillAlive)) {
        let _ = kill(pid, Signal::SIGKILL);
        let _ = waitpid(pid, None);
    }
    assert_eq!(
        status,
        Err(Errno::ECHILD),
        "created child must be killed AND reaped before error return"
    );
}

#[cfg(unix)]
#[test]
fn post_spawn_failure_kills_and_reaps_created_child() {
    failure_reaps(Failure::PostSpawn);
}

#[cfg(unix)]
#[test]
fn child_wrapper_failure_kills_and_reaps_created_child() {
    failure_reaps(Failure::WrapChild);
}

#[derive(Debug)]
struct SuccessfulWrapper(Arc<Mutex<Vec<&'static str>>>);
impl CommandWrapper for SuccessfulWrapper {
    fn pre_spawn(&mut self, command: &mut Command, _: &CommandWrap) -> io::Result<()> {
        self.0.lock().unwrap().push("pre");
        command.env("ACQUISITION_TEST_CODE", "23");
        Ok(())
    }
    fn post_spawn(
        &mut self,
        _: &mut Command,
        child: &mut Child,
        _: &CommandWrap,
    ) -> io::Result<()> {
        // Deterministically model a child that exits before post_spawn runs.
        assert_eq!(child.wait()?.code(), Some(23));
        self.0.lock().unwrap().push("post");
        Ok(())
    }
    fn wrap_child(
        &mut self,
        child: Box<dyn ChildWrapper>,
        _: &CommandWrap,
    ) -> io::Result<Box<dyn ChildWrapper>> {
        self.0.lock().unwrap().push("wrap");
        Ok(child)
    }
}

#[test]
fn successful_acquisition_delegates_hooks_and_preserves_child_execution() {
    let stages = Arc::new(Mutex::new(Vec::new()));
    let mut command = command();
    // Replace the sleeper argv, preserving the configured Python executable.
    command = Command::new(command.get_program());
    command.args([
        "-c",
        "import os; raise SystemExit(int(os.environ['ACQUISITION_TEST_CODE']))",
    ]);
    let mut child = acquire::spawn(command, SuccessfulWrapper(Arc::clone(&stages))).unwrap();
    assert_eq!(*stages.lock().unwrap(), ["pre", "post", "wrap"]);
    assert_eq!(child.wait().unwrap().code(), Some(23));
}
