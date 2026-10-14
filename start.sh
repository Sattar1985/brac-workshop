#!/bin/sh
# غيّر رمز دخول المقدم من هنا
export PIN="${PIN:-2026}"
export PORT="${PORT:-3000}"
cd "$(dirname "$0")" && node server.js
