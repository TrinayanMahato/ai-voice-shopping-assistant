import logging
from typing import Any, Dict, Optional
from app.core.config import settings

logger = logging.getLogger(__name__)

db_pool = None


async def init_db_pool():
    global db_pool
    try:
        import asyncpg

        ssl_option = False if settings.SSL_MODE == "disable" else True
        db_pool = await asyncpg.create_pool(
            host=settings.DB_HOST,
            port=settings.DB_PORT,
            user=settings.DB_USER,
            password=settings.DB_PASSWORD,
            database=settings.DB_NAME,
            ssl=settings.SSL_MODE,
            min_size=1,
            max_size=10,
        )
        logger.info("Database connection pool initialized successfully.")
    except Exception as e:
        logger.warning(f"Could not initialize asyncpg pool: {e}")
        db_pool = None


async def close_db_pool():
    global db_pool
    if db_pool is not None:
        await db_pool.close()
        logger.info("Database connection pool closed.")
        db_pool = None


async def get_db_connection():
    if db_pool is None:
        import asyncpg

        ssl_option = False if settings.SSL_MODE == "disable" else True
        conn = await asyncpg.connect(
            host=settings.DB_HOST,
            port=settings.DB_PORT,
            user=settings.DB_USER,
            password=settings.DB_PASSWORD,
            database=settings.DB_NAME,
            ssl=ssl_option,
        )
        return conn
    return None
