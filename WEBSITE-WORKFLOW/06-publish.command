#!/bin/zsh
# PUBLISH LIVE WEBSITE: Publish the saved version at 100 percent after explicit confirmation.
set -eu
workflow_dir="${0:A:h}"
project_dir="${workflow_dir:h}"
node_version="$(< "$project_dir/.nvmrc")"
node_binary="$HOME/.nvm/versions/node/v$node_version/bin/node"
if [[ ! -x "$node_binary" ]]; then
  print -u2 "Node $node_version is missing. In WebStorm Terminal, run: nvm install && nvm use"
  exit 1
fi
exec "$node_binary" "$workflow_dir/workflow.mjs" publish "$@"
