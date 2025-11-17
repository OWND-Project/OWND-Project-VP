#!/bin/bash
source /root/.bashrc

# workaround: Since the above process does not load the file properly, explicitly execute the loading process.
source /etc/profile.d/app_config.sh

nvm use 20

cd /srv || exit

if [[ "$HOSTNAME" =~ active ]]; then
  if [[ "$DEPLOYMENT_GROUP_NAME" =~ ^boolnode ]]; then
    pm2 start "yarn start" --name boolnode --cwd /srv --update-env -o /var/log/pm2/out.log  -e /var/log/pm2/error.log
  elif [[ "$DEPLOYMENT_GROUP_NAME" =~ ^verifier ]]; then
    pm2 start "yarn start" --name verifier --cwd /srv --update-env -o /var/log/pm2/out.log  -e /var/log/pm2/error.log
  fi
elif [[ "$DEPLOYMENT_GROUP_NAME" =~ ^api ]]; then
    pm2 start "yarn start" --name api --cwd /srv --update-env -o /var/log/pm2/out.log  -e /var/log/pm2/error.log
fi
pm2 startup
pm2 save
