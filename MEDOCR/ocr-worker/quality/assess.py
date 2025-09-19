"""
Compatibility shim: expose compute_confidence under quality.assess
so imports like `from quality.assess import compute_confidence` work
even though the implementation lives in asses.py.
"""
from .asses import compute_confidence  # re-export

__all__ = ["compute_confidence"]

