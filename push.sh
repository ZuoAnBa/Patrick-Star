#!/bin/bash

echo "🚀 开始上传..."

git add .

if [ -z "$1" ]; then
  msg="update"
else
  msg="$1"
fi

git commit -m "$msg"

git push

echo "✅ 上传完成"