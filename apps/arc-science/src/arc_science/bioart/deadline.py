"""Main-thread deadline for the synchronous CLI transport, without workers."""
from contextlib import contextmanager
import signal
import threading
import time


@contextmanager
def request_deadline(seconds):
    """Bound total request time, and on POSIX also interrupt blocking socket I/O.

    On POSIX a SIGALRM interval timer preempts a stuck blocking read. Windows has no
    such signal, so the deadline is cooperative: callers check remaining() and the
    transport passes remaining() as its per-request timeout to bound each read.
    """
    if threading.current_thread() is not threading.main_thread():
        raise ValueError('BioArt network deadlines require the POSIX main thread; use the CLI')
    end=time.monotonic()+seconds

    def remaining():
        budget=end-time.monotonic()
        if budget<=0: raise ValueError('BioArt request total timeout')
        return budget

    if not all(hasattr(signal,name) for name in ('SIGALRM','ITIMER_REAL','setitimer','getitimer','pthread_sigmask')):
        # No preemptive alarm (Windows): cooperative deadline plus transport timeouts.
        yield remaining
        remaining()
        return
    if any(signal.getitimer(signal.ITIMER_REAL)):
        raise ValueError('BioArt network deadline cannot replace an existing alarm')
    if signal.SIGALRM in signal.pthread_sigmask(signal.SIG_BLOCK,set()):
        raise ValueError('BioArt network deadline requires an unblocked alarm signal')

    def expired(*_):
        raise ValueError('BioArt request total timeout')

    previous=signal.getsignal(signal.SIGALRM)
    signal.signal(signal.SIGALRM,expired)
    try:
        signal.setitimer(signal.ITIMER_REAL,remaining())
        yield remaining
        remaining()
    finally:
        signal.setitimer(signal.ITIMER_REAL,0)
        signal.signal(signal.SIGALRM,previous)
