from typing import Literal
from pydantic import BaseModel, Field

class LocationRequest(BaseModel):
    lat: float = Field(..., ge=-90, le=90, description="Vĩ độ WGS84")
    lon: float = Field(..., ge=-180, le=180, description="Kinh độ WGS84")
    days_ahead: int = Field(default=7, ge=1, le=14, description="Số ngày dự báo")
    user_group: Literal["general", "child", "elder", "sick"] = Field(
        default="general", description="Nhóm người dùng để nhận khuyến nghị"
    )