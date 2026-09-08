"""Main-thread POSIX deadline for the synchronous CLI transport, without workers."""
from contextlib import contextmanager
import signal
import threading
import time


@contextmanager
def request_deadline(seconds):
    """Interrupt blocking Python socket I/O as well as check monotonic progress.

    SIGALRM belongs to this scope only. Refuse callers whose alarm/thread state
    cannot support it; never replace another active timer or launch a worker.
    """
    if threading.current_thread() is not threading.main_thread():
        raise ValueError('BioArt network deadlines require the POSIX main thread; use the CLI')
    if not all(hasattr(signal,name) for name in ('SIGALRM','ITIMER_REAL','setitimer','getitimer','pthread_sigmask')):
        raise ValueError('BioArt network deadlines require POSIX alarm support')
    if any(signal.getitimer(signal.ITIMER_REAL)):
        raise ValueError('BioArt network deadline cannot replace an existing alarm')
    if signal.SIGALRM in signal.pthread_sigmask(signal.SIG_BLOCK,set()):
        raise ValueError('BioArt network deadline requires an unblocked alarm signal')
    end=time.monotonic()+seconds

    def expired(*_):
        raise ValueError('BioArt request total timeout')

    def remaining():
        budget=end-time.monotonic()
        if budget<=0: expired()
        return budget

    previous=signal.getsignal(signal.SIGALRM)
    signal.signal(signal.SIGALRM,expired)
    try:
        signal.setitimer(signal.ITIMER_REAL,remaining())
        yield remaining
        remaining()
    finally:
        signal.setitimer(signal.ITIMER_REAL,0)
        signal.signal(signal.SIGALRM,previous)
