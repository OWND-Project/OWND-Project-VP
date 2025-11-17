#!/bin/bash
. ~/.nvm/nvm.sh
cd /srv || exit
yarn
yarn build