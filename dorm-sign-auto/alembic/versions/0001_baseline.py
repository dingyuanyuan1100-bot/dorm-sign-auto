"""baseline: dorm-sign-auto 初始表结构（与旧库 schema 一致）

Revision ID: 0001_baseline
Revises:
Create Date: 2026-11-01

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "0001_baseline"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("username", sa.String(length=32), nullable=False, unique=True),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("created_at", sa.String(length=19), nullable=False),
    )
    op.create_table(
        "dorm_accounts",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("user_id", sa.Integer(), nullable=False, unique=True),
        sa.Column("student_id", sa.String(length=32), nullable=False),
        sa.Column("enc_password", sa.String(length=512), nullable=False),
        sa.Column("nickname", sa.String(length=32), nullable=False, server_default=""),
        sa.Column("created_at", sa.String(length=19), nullable=False),
        sa.Column("updated_at", sa.String(length=19), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
    )
    op.create_table(
        "schedules",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("dorm_account_id", sa.Integer(), nullable=False),
        sa.Column("mode", sa.String(length=8), nullable=False),
        sa.Column("sign_time", sa.String(length=5), nullable=False),
        sa.Column("sign_date", sa.String(length=10), nullable=True),
        sa.Column("enabled", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("remark", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("last_run_at", sa.String(length=19), nullable=True),
        sa.Column("last_status", sa.String(length=16), nullable=True),
        sa.Column("last_msg", sa.String(length=255), nullable=True),
        sa.Column("next_run_at", sa.String(length=19), nullable=True),
        sa.Column("created_at", sa.String(length=19), nullable=False),
        sa.Column("updated_at", sa.String(length=19), nullable=True),
        sa.Column("location_id", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["dorm_account_id"], ["dorm_accounts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
    )
    op.create_index("idx_schedules_enabled", "schedules", ["enabled", "mode"])
    op.create_table(
        "sign_logs",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("schedule_id", sa.Integer(), nullable=True),
        sa.Column("run_at", sa.String(length=19), nullable=False),
        sa.Column("success", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("msg", sa.String(length=255), nullable=True),
        sa.Column("detail", sa.String(length=255), nullable=True),
    )
    op.create_index("idx_logs_user", "sign_logs", ["user_id", "run_at"])
    op.create_table(
        "locations",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=32), nullable=False, server_default="默认位置"),
        sa.Column("lat", sa.String(length=16), nullable=False),
        sa.Column("lng", sa.String(length=16), nullable=False),
        sa.Column("address", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("is_default", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.String(length=19), nullable=False),
        sa.Column("updated_at", sa.String(length=19), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
    )
    op.create_index("idx_locations_user", "locations", ["user_id"])


def downgrade() -> None:
    op.drop_index("idx_locations_user", table_name="locations")
    op.drop_table("locations")
    op.drop_index("idx_logs_user", table_name="sign_logs")
    op.drop_table("sign_logs")
    op.drop_index("idx_schedules_enabled", table_name="schedules")
    op.drop_table("schedules")
    op.drop_table("dorm_accounts")
    op.drop_table("users")
