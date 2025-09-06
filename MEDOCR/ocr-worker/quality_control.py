#!/usr/bin/env python3
"""
Quality control validators for extracted referral data.
Produces qc_results with errors and warnings to guide routing.
"""
from typing import Dict, List, Tuple
import re

APPROVED_CPTS = {
    '95810', '95811', 'G0399', '95806', '95782', '95783'
}

def _is_valid_date_mmddyyyy(s: str) -> bool:
    if not isinstance(s, str):
        return False
    m = re.match(r"^(0?[1-9]|1[0-2])/(0?[1-9]|[12]\d|3[01])/(\d{4})$", s.strip())
    return bool(m)

def _is_valid_phone_nanp(s: str) -> bool:
    if not isinstance(s, str):
        return False
    d = re.sub(r"\D", "", s)
    if len(d) != 10:
        return False
    # NANP: NXX-NXX-XXXX, N=2-9, X=0-9; disallow 9 in area code middle per classic rules
    area = d[:3]; exch = d[3:6]
    return bool(re.match(r"^[2-9][0-8]\d$", area)) and bool(re.match(r"^[2-9]\d\d$", exch))

def _is_valid_bp(s: str) -> bool:
    if not isinstance(s, str):
        return False
    return bool(re.match(r"^\d{2,3}/\d{2,3}$", s.strip()))

def _is_valid_ins_id(s: str) -> bool:
    if not isinstance(s, str):
        return False
    return bool(re.match(r"^[A-Za-z0-9\-]+$", s.strip()))

def _validate_cpt_list(cpts) -> Tuple[List[str], List[str]]:
    errors: List[str] = []
    warnings: List[str] = []
    if not cpts:
        warnings.append("CPT missing")
        return errors, warnings
    bad = [c for c in cpts if c not in APPROVED_CPTS]
    if bad:
        errors.append(f"Invalid CPT code(s): {', '.join(bad)}")
    # 95810 and 95811 together is not allowed (split-night logic handles either/or)
    if '95810' in cpts and '95811' in cpts:
        errors.append("CPT conflict: 95810 and 95811 cannot be together")
    return errors, warnings

def run_qc(data: Dict) -> Dict[str, List[str]]:
    errors: List[str] = []
    warnings: List[str] = []

    p = (data.get('patient') or {})
    ins = (data.get('insurance') or {}).get('primary', {})
    proc = (data.get('procedure') or {})

    # Demographics
    if not p.get('last_name') or not p.get('first_name'):
        errors.append('Missing patient name')
    if p.get('dob') and not _is_valid_date_mmddyyyy(p['dob']):
        errors.append('DOB format invalid (MM/DD/YYYY)')
    elif not p.get('dob'):
        errors.append('Missing DOB')
    if not p.get('mrn'):
        warnings.append('Missing MRN')
    phone = p.get('phone_home') or p.get('phone')
    if phone and not _is_valid_phone_nanp(phone):
        warnings.append('Phone format invalid')
    if not phone:
        warnings.append('Missing patient phone')
    bp = p.get('blood_pressure')
    if bp and not _is_valid_bp(bp):
        warnings.append('Blood pressure format invalid')

    # Insurance
    if not ins.get('carrier'):
        warnings.append('Missing insurance carrier')
    mid = ins.get('member_id')
    if mid and not _is_valid_ins_id(mid):
        warnings.append('Insurance member ID format invalid')
    if not mid:
        warnings.append('Missing insurance member ID')

    # Procedure / CPT
    cpts = proc.get('cpt') if isinstance(proc.get('cpt'), list) else ([] if proc.get('cpt') is None else [proc.get('cpt')])
    cpt_err, cpt_warn = _validate_cpt_list(cpts)
    errors.extend(cpt_err); warnings.extend(cpt_warn)

    # Document-level dates
    if data.get('document_date') and not _is_valid_date_mmddyyyy(data['document_date']):
        warnings.append('Referral date format invalid (MM/DD/YYYY)')
    if data.get('intake_date') and not _is_valid_date_mmddyyyy(data['intake_date']):
        warnings.append('Intake date format invalid (MM/DD/YYYY)')

    return {
        'errors': errors,
        'warnings': warnings
    }

