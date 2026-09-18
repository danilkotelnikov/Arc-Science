//! Crash containment for the supervised worker tree.
//!
//! The Python worker and everything it spawns must not outlive this supervisor,
//! even when the supervisor is force-killed or crashes and no cooperative shutdown
//! runs. On Windows the supervisor places *itself* in a job object configured with
//! `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` before spawning. Child processes join their
//! parent's job automatically, and `process-wrap`'s own per-worker job nests beneath
//! it (Windows 8+), so when this process ends for any reason the kernel closes the
//! last handle and terminates the entire tree. The handle is deliberately never
//! closed while running: closing it would terminate this process as a member.
//!
//! POSIX relies on the worker process group plus the parent-stdin lifetime and needs
//! nothing here. Raw `kernel32` FFI keeps this dependency-free.

use crate::Result;

#[cfg(windows)]
mod ffi {
    use std::ffi::c_void;

    pub type Handle = *mut c_void;
    pub type Bool = i32;
    pub type Dword = u32;

    #[repr(C)]
    pub struct BasicLimitInformation {
        pub per_process_user_time_limit: i64,
        pub per_job_user_time_limit: i64,
        pub limit_flags: Dword,
        pub minimum_working_set_size: usize,
        pub maximum_working_set_size: usize,
        pub active_process_limit: Dword,
        pub affinity: usize,
        pub priority_class: Dword,
        pub scheduling_class: Dword,
    }

    #[repr(C)]
    pub struct IoCounters {
        pub read_operation_count: u64,
        pub write_operation_count: u64,
        pub other_operation_count: u64,
        pub read_transfer_count: u64,
        pub write_transfer_count: u64,
        pub other_transfer_count: u64,
    }

    #[repr(C)]
    pub struct ExtendedLimitInformation {
        pub basic: BasicLimitInformation,
        pub io: IoCounters,
        pub process_memory_limit: usize,
        pub job_memory_limit: usize,
        pub peak_process_memory_used: usize,
        pub peak_job_memory_used: usize,
    }

    pub const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE: Dword = 0x2000;
    pub const JOB_OBJECT_EXTENDED_LIMIT_INFORMATION: i32 = 9;

    #[link(name = "kernel32")]
    unsafe extern "system" {
        pub fn CreateJobObjectW(attributes: *const c_void, name: *const u16) -> Handle;
        pub fn SetInformationJobObject(
            job: Handle,
            class: i32,
            information: *const c_void,
            length: Dword,
        ) -> Bool;
        pub fn AssignProcessToJobObject(job: Handle, process: Handle) -> Bool;
        pub fn GetCurrentProcess() -> Handle;
        pub fn CloseHandle(handle: Handle) -> Bool;
        pub fn GetLastError() -> Dword;
    }
}

/// Bind this process, and therefore every worker it spawns, to a kill-on-close job.
///
/// Call once, before spawning the worker. On success the job handle stays open for
/// the life of the process by design.
#[cfg(windows)]
pub fn contain_process_tree() -> Result<()> {
    use ffi::*;
    use std::{ffi::c_void, mem, ptr};
    // SAFETY: plain Win32 calls with valid, zero-initialised, correctly sized
    // arguments; the job handle intentionally outlives this function (see module docs).
    unsafe {
        let job = CreateJobObjectW(ptr::null(), ptr::null());
        if job.is_null() {
            return Err(format!("CreateJobObjectW failed (error {})", GetLastError()).into());
        }
        let mut limits: ExtendedLimitInformation = mem::zeroed();
        limits.basic.limit_flags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        if SetInformationJobObject(
            job,
            JOB_OBJECT_EXTENDED_LIMIT_INFORMATION,
            &limits as *const ExtendedLimitInformation as *const c_void,
            mem::size_of::<ExtendedLimitInformation>() as Dword,
        ) == 0
        {
            let error = GetLastError();
            CloseHandle(job);
            return Err(format!("SetInformationJobObject failed (error {error})").into());
        }
        if AssignProcessToJobObject(job, GetCurrentProcess()) == 0 {
            let error = GetLastError();
            CloseHandle(job);
            return Err(format!("AssignProcessToJobObject failed (error {error})").into());
        }
        // `job` is never closed: the kernel releases it when this process ends,
        // which is exactly the moment the tree must die.
    }
    Ok(())
}

#[cfg(not(windows))]
pub fn contain_process_tree() -> Result<()> {
    Ok(())
}

#[cfg(all(test, windows))]
mod tests {
    #[test]
    fn supervisor_joins_a_kill_on_close_job() {
        // Joining is idempotent for our purposes and harmless for the test harness:
        // the limit only fires when the last handle closes, i.e. at process exit.
        super::contain_process_tree().expect("job containment");
    }
}
