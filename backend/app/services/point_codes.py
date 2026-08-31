from sqlalchemy import Integer, cast, func, select
from sqlalchemy.orm import Session

from app.models.entities import Point, PointReviewCodeCounter


def allocate_point_review_code(db: Session) -> str:
    counter = db.get(PointReviewCodeCounter, 1, with_for_update=True)
    if counter is None:
        largest = db.scalar(
            select(func.max(cast(func.substr(Point.review_code, 2), Integer))).where(
                Point.review_code.is_not(None)
            )
        )
        counter = PointReviewCodeCounter(id=1, next_value=(largest or 0) + 1)
        db.add(counter)
        db.flush()

    code = f"P{counter.next_value:04d}"
    counter.next_value += 1
    db.flush()
    return code
