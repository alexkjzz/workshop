import logging
from datetime import datetime

from ..schemas.prediction import RiskResult
from .sensor_fusion import FusedEvidence

logger = logging.getLogger("RISK")


def risk_level(score: int) -> str:
    if score < 25:
        return "SAFE"
    if score < 50:
        return "LOW"
    if score < 75:
        return "MEDIUM"
    if score < 90:
        return "HIGH"
    return "CRITICAL"


def evaluate(evidence: FusedEvidence, timestamp: datetime) -> RiskResult:
    intrusion = evidence.intrusion_score > 0
    environment = evidence.environmental_score > 0
    score = max(evidence.intrusion_score, evidence.environmental_score)
    if intrusion and environment:
        category = "MULTI_THREAT"
        score = min(100, score + 12)
    elif intrusion:
        category = "INTRUSION"
    elif environment:
        category = "ENVIRONMENT" if evidence.correlated_environment else "SENSOR_ANOMALY"
    else:
        category = "SAFE"
    result = RiskResult(risk_score=score, risk_level=risk_level(score), category=category,
                        reasons=evidence.reasons, confidence=round(evidence.confidence, 4),
                        degraded=evidence.degraded, timestamp=timestamp)
    logger.info("%s score=%d category=%s", result.risk_level, score, category)
    return result
