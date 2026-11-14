from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, BaseModel


class Location(BaseModel):
    __tablename__ = "locations"

    user_id: Mapped[int] = mapped_column(nullable=False, index=True, comment="所属用户")
    name: Mapped[str] = mapped_column(String(32), nullable=False, default="默认位置", comment="名称")
    lat: Mapped[str] = mapped_column(String(16), nullable=False, comment="纬度")
    lng: Mapped[str] = mapped_column(String(16), nullable=False, comment="经度")
    address: Mapped[str] = mapped_column(String(64), nullable=False, default="", comment="地址")
    is_default: Mapped[int] = mapped_column(nullable=False, default=0, comment="是否默认")
