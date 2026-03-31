@echo off
echo 🚀 开始上传...

git add .

set msg=%1
if "%msg%"=="" set msg=update

git commit -m "%msg%"

git push

echo ✅ 上传完成
pause