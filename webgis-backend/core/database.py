import asyncio
import math
import os
from typing import Any

_pool: Any | None = None
_pool_lock = asyncio.Lock()

def _get_database_url() -> str:
    database_url = os.getenv("AIRHCM_DATABASE_URL") or os.getenv("DATABASE_URL")
    if not database_url:
        raise RuntimeError("Chưa cấu hình DATABASE_URL để kết nối PostgreSQL.")
    return database_url

async def get_db_connection() -> Any:
    global _pool
    if _pool is not None:
        return _pool

    async with _pool_lock:
        if _pool is not None:
            return _pool
        try:
            import asyncpg
        except ImportError as exc:
            raise RuntimeError("Thiếu thư viện asyncpg.") from exc

        try:
            _pool = await asyncpg.create_pool(
                dsn=_get_database_url(),
                min_size=int(os.getenv("AIRHCM_DB_POOL_MIN_SIZE", "1")),
                max_size=int(os.getenv("AIRHCM_DB_POOL_MAX_SIZE", "10")),
                command_timeout=float(os.getenv("AIRHCM_DB_COMMAND_TIMEOUT", "30")),
            )
        except Exception as exc:
            raise RuntimeError(f"Không thể kết nối PostgreSQL: {exc}") from exc
    return _pool

async def close_db_connection() -> None:
    global _pool
    async with _pool_lock:
        if _pool is not None:
            await _pool.close()
            _pool = None