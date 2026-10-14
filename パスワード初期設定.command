#!/bin/zsh
cd -- "$(dirname -- "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.jsが見つかりません。Codexへこのメッセージを伝えてください。"
  read "?Enterキーで閉じます。"
  exit 1
fi
node scripts/setup.mjs --security-only
setup_result=$?
if [[ $setup_result -ne 0 ]]; then
  echo "初期設定は完了していません。表示された理由を確認し、もう一度開いてください。"
fi
read "?Enterキーで閉じます。"
exit $setup_result
