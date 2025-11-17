#!/bin/bash
. ~/.nvm/nvm.sh
pm2 install pm2-logrotate
pm2 set pm2-logrotate:compress true
pm2 set pm2-logrotate:max_size 2M
