"""Router for analytics endpoints.

Each endpoint performs SQL aggregation queries on the interaction data
populated by the ETL pipeline. All endpoints require a `lab` query
parameter to filter results by lab (e.g., "lab-01").
"""

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select, case
from sqlmodel.ext.asyncio.session import AsyncSession

from app.database import get_session
from app.models.item import ItemRecord
from app.models.learner import Learner
from app.models.interaction import InteractionLog

router = APIRouter()


async def _get_lab_id_by_title(session: AsyncSession, lab: str) -> int | None:
    """Find lab item ID by matching title (e.g. 'lab-04' → 'Lab 04')."""
    lab_title = lab.replace("lab-", "Lab ").replace("LAB-", "Lab ")
    lab_stmt = select(ItemRecord.id).where(
        ItemRecord.title.ilike(f"%{lab_title}%"),
        ItemRecord.type == "lab"
    )
    result = (await session.exec(lab_stmt)).first()
    return result[0] if result else None


async def _get_task_ids_for_lab(session: AsyncSession, lab_id: int) -> list[int]:
    """Get all task IDs that belong to a lab."""
    tasks_stmt = select(ItemRecord.id).where(ItemRecord.parent_id == lab_id)
    return [row[0] for row in (await session.exec(tasks_stmt)).all()]


@router.get("/scores")
async def get_scores(
    lab: str = Query(..., description="Lab identifier, e.g. 'lab-01'"),
    session: AsyncSession = Depends(get_session),
):
    """Score distribution histogram for a given lab."""
    lab_id = await _get_lab_id_by_title(session, lab)
    
    if not lab_id:
        return [
            {"bucket": "0-25", "count": 0},
            {"bucket": "26-50", "count": 0},
            {"bucket": "51-75", "count": 0},
            {"bucket": "76-100", "count": 0},
        ]

    task_ids = await _get_task_ids_for_lab(session, lab_id)
    
    if not task_ids:
        return [
            {"bucket": "0-25", "count": 0},
            {"bucket": "26-50", "count": 0},
            {"bucket": "51-75", "count": 0},
            {"bucket": "76-100", "count": 0},
        ]

    score_bucket = case(
        (InteractionLog.score <= 25, "0-25"),
        (InteractionLog.score <= 50, "26-50"),
        (InteractionLog.score <= 75, "51-75"),
        else_="76-100",
    )

    stmt = select(
        score_bucket.label("bucket"),
        func.count().label("count")
    ).where(
        InteractionLog.item_id.in_(task_ids),
        InteractionLog.score.isnot(None)
    ).group_by(score_bucket)

    result = await session.exec(stmt)
    bucket_counts = {row[0]: row[1] for row in result.all()}

    all_buckets = ["0-25", "26-50", "51-75", "76-100"]
    return [
        {"bucket": bucket, "count": bucket_counts.get(bucket, 0)}
        for bucket in all_buckets
    ]


@router.get("/pass-rates")
async def get_pass_rates(
    lab: str = Query(..., description="Lab identifier, e.g. 'lab-01'"),
    session: AsyncSession = Depends(get_session),
):
    """Per-task pass rates for a given lab."""
    lab_id = await _get_lab_id_by_title(session, lab)
    
    if not lab_id:
        return []

    tasks_stmt = select(ItemRecord.id, ItemRecord.title).where(
        ItemRecord.parent_id == lab_id
    ).order_by(ItemRecord.title)
    tasks = (await session.exec(tasks_stmt)).all()

    result = []
    for task_id, task_title in tasks:
        stats_stmt = select(
            func.avg(InteractionLog.score).label("avg_score"),
            func.count().label("attempts")
        ).where(
            InteractionLog.item_id == task_id,
            InteractionLog.score.isnot(None)
        )
        stats = (await session.exec(stats_stmt)).first()

        avg_score = round(float(stats[0]), 1) if stats[0] is not None else 0.0
        attempts = stats[1] or 0

        result.append({
            "task": task_title,
            "avg_score": avg_score,
            "attempts": attempts,
        })

    return result


@router.get("/timeline")
async def get_timeline(
    lab: str = Query(..., description="Lab identifier, e.g. 'lab-01'"),
    session: AsyncSession = Depends(get_session),
):
    """Submissions per day for a given lab."""
    lab_id = await _get_lab_id_by_title(session, lab)
    
    if not lab_id:
        return []

    task_ids = await _get_task_ids_for_lab(session, lab_id)
    
    if not task_ids:
        return []

    stmt = select(
        func.date(InteractionLog.created_at).label("date"),
        func.count().label("submissions")
    ).where(
        InteractionLog.item_id.in_(task_ids)
    ).group_by(
        func.date(InteractionLog.created_at)
    ).order_by(
        func.date(InteractionLog.created_at)
    )

    result = await session.exec(stmt)
    return [
        {"date": row[0], "submissions": row[1]}
        for row in result.all()
    ]


@router.get("/groups")
async def get_groups(
    lab: str = Query(..., description="Lab identifier, e.g. 'lab-01'"),
    session: AsyncSession = Depends(get_session),
):
    """Per-group performance for a given lab."""
    lab_id = await _get_lab_id_by_title(session, lab)
    
    if not lab_id:
        return []

    task_ids = await _get_task_ids_for_lab(session, lab_id)
    
    if not task_ids:
        return []

    stmt = select(
        Learner.student_group.label("group"),
        func.avg(InteractionLog.score).label("avg_score"),
        func.count(func.distinct(Learner.id)).label("students")
    ).join(
        InteractionLog, InteractionLog.learner_id == Learner.id
    ).where(
        InteractionLog.item_id.in_(task_ids),
        InteractionLog.score.isnot(None)
    ).group_by(
        Learner.student_group
    ).order_by(
        Learner.student_group
    )

    result = await session.exec(stmt)
    return [
        {
            "group": row[0],
            "avg_score": round(float(row[1]), 1) if row[1] is not None else 0.0,
            "students": row[2],
        }
        for row in result.all()
    ]
