"""GET /api/xva/calibration/latest must hand back the same shape as POST /calibrate: the fit table as a list
under fit_details, with converged / iterations / surface_errors alongside. The row stores them in one object."""
from api.routes.xva import stored_calibration_fields


def test_stored_object_is_unwrapped():
    stored = {"basket": [{"expiry_y": 1, "tenor_y": 5, "mkt_vol_bp": 80.0, "mdl_vol_bp": 80.4, "error_bp": 0.4}],
              "surface_errors": [{"expiry_y": 1, "tenor_y": 10, "error_bp": -1.2}],
              "converged": True, "iterations": 7, "snap_date": "2026-11-03", "curve_source": "curve",
              "curve_id": "USD_SOFR", "curve_note": None}
    out = stored_calibration_fields(stored)
    assert out["fit_details"] == stored["basket"]
    assert out["surface_errors"] == stored["surface_errors"]
    assert out["converged"] is True and out["iterations"] == 7
    assert out["curve_source"] == "curve" and out["snap_date"] == "2026-11-03"


def test_stored_json_string_is_parsed():
    out = stored_calibration_fields('{"basket": [{"expiry_y": 2}], "converged": false, "iterations": 3}')
    assert out["fit_details"] == [{"expiry_y": 2}]
    assert out["converged"] is False


def test_legacy_list_and_garbage_still_give_a_list():
    assert stored_calibration_fields([{"expiry_y": 1}])["fit_details"] == [{"expiry_y": 1}]
    assert stored_calibration_fields(None)["fit_details"] == []
    assert stored_calibration_fields("not json")["fit_details"] == []
    assert stored_calibration_fields({"basket": "oops"})["fit_details"] == []
