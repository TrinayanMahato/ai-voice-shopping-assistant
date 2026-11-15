import os

path = r'c:\Users\Admin\xai-langgraph-ai-agent\app\tools\retrieval.py'

with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

target = '"doc_version", "last_updated",'
replacement = '"doc_version", "last_updated",\n    "media_id", "feature_id", "image_url",'

if target in content and "media_id" not in content:
    content = content.replace(target, replacement)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)
    print("Successfully updated _METADATA_PASSTHROUGH")
else:
    print("Target not found or already updated")
