import asyncio
import os
import sys

# add current directory to path
sys.path.append(r"d:\OneDrive - Cavitak marketing Pvt ltd\Desktop\xai-backend")

from app.core.db import get_db_connection

async def fetch_latest_error():
    conn = await get_db_connection()
    try:
        row = await conn.fetchrow(
            "SELECT db_error_text FROM error_logs WHERE api_name = '/create_chqme_order' ORDER BY created_at DESC LIMIT 1"
        )
        if row:
            print("LATEST ERROR:", row["db_error_text"])
        else:
            print("No errors found.")
    finally:
        await conn.close()

if __name__ == "__main__":
    asyncio.run(fetch_latest_error())
