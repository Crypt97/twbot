@echo off
echo Twitch Bot indítása...
echo.
set /p CHANNEL_NAME="Add meg a Twitch csatorna nevét: "
echo.
echo Kapcsolódás a(z) %CHANNEL_NAME% csatornához...
node twitch-bot.js %CHANNEL_NAME%
echo.
pause