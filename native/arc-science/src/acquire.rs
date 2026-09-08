//! Single-wrapper acquisition boundary for the supervisor's process group/job.
use process_wrap::std::{ChildWrapper, CommandWrap, CommandWrapper};
use std::{
    io,
    process::{Child, Command},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};

/// Drive one containment wrapper, owning the child before any fallible hook.
///
/// process-wrap 9.0's general spawn pipeline drops an unguarded Child on hook
/// errors. Our actual wrappers are one ProcessGroup OR one JobObject; neither
/// needs sibling wrapper state. Do not extend this into a multi-wrapper pipeline.
pub fn spawn(
    mut command: Command,
    mut wrapper: impl CommandWrapper,
) -> io::Result<Box<dyn ChildWrapper>> {
    let context = CommandWrap::from(Command::new(""));
    wrapper.pre_spawn(&mut command, &context)?;
    let armed = Arc::new(AtomicBool::new(true));
    // No allocation or fallible setup between OS creation and RAII ownership.
    let mut guard = AcquisitionGuard {
        child: Some(command.spawn()?),
        armed: Arc::clone(&armed),
    };
    wrapper.post_spawn(
        &mut command,
        guard.child.as_mut().expect("owned child"),
        &context,
    )?;
    // The Box is consumed by wrap_child; if JobObject setup/resume fails, its
    // drop still kills and waits the raw child, even though no JobObject exists.
    let child = wrapper.wrap_child(Box::new(guard), &context)?;
    // Successful acquisition transfers lifecycle ownership to the supervisor.
    // Do not kill a raw PID again after ProcessGroup's waitpid has reaped it.
    armed.store(false, Ordering::SeqCst);
    Ok(child)
}

#[derive(Debug)]
struct AcquisitionGuard {
    child: Option<Child>,
    armed: Arc<AtomicBool>,
}

impl Drop for AcquisitionGuard {
    fn drop(&mut self) {
        if !self.armed.load(Ordering::SeqCst) {
            return;
        }
        if let Some(child) = self.child.as_mut() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

impl ChildWrapper for AcquisitionGuard {
    fn inner(&self) -> &dyn ChildWrapper {
        self.child.as_ref().expect("owned child")
    }
    fn inner_mut(&mut self) -> &mut dyn ChildWrapper {
        self.child.as_mut().expect("owned child")
    }
    fn into_inner(mut self: Box<Self>) -> Box<dyn ChildWrapper> {
        Box::new(self.child.take().expect("owned child"))
    }
}
