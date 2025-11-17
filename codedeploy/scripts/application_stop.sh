#!/bin/bash
source /root/.bashrc
nvm use 20
# pm2のプロセスが存在するか確認
if pm2 list | grep -qE "boolnode|verifier|api"; then
    pm2 delete all
fi