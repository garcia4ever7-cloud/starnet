#!/data/data/com.termux/files/usr/bin/bash
# register-set.sh <tag> <name>... : register <name>-original.png (workshop) + bg-<name>-3840x2160.png (outbox/litedesignz/seasons)
# in CENTRAL OUTBOX (manifest, project litedesignz) and DELIVERABLES (library), as "LiteDesignz seasonal slideshow backgrounds".
set -e
TAG=$1; shift; W=$HOME/.local/share/StarNet/workspaces; RID=hf-litedesignz-seasons; D=$W/webdesigner/workshop/$RID; O=$W/webdesigner/outbox/litedesignz/seasons
cp -p $W/.deliverables/manifest.jsonl $W/.deliverables/manifest.jsonl.bak-20261128-$TAG; cp -p $W/deliverables.library.jsonl $W/deliverables.library.jsonl.bak-20261128-$TAG
cd $HOME/starnet-next; node -e '
const fs=require("fs"),path=require("path"),crypto=require("crypto");const {makeDeliverableManifest}=require("./sidecar/deliverable-manifest.js");
const W=process.argv[1];const N=process.argv.slice(3);const m=makeDeliverableManifest({fs,path,crypto,now:()=>Date.now(),root:path.join(W,".deliverables"),workspaceRootOf:a=>path.join(W,String(a||"agent"))});
const files=N.map(n=>"outbox/litedesignz/seasons/bg-"+n+"-3840x2160.png").concat(N.map(n=>"workshop/hf-litedesignz-seasons/"+n+"-original.png"));
const r=m.register({ownerAgentId:"webdesigner",runId:process.argv[2],projectId:"litedesignz",shareWith:["agent","publisher","qceditor"],files});
console.log("CENTRAL OUTBOX register:",r.ok,(r.entries||[]).length,"entries",r.error||"")' $W $RID "$@" 2>&1 | grep -v Experimental
set -a; . $HOME/.config/starnet/env; set +a; U=http://127.0.0.1:8787; mkdir -p $D/seasons
reg(){ curl -s -m15 -X POST $U/api/deliverables/register -H "x-starnet-token: $STARNET_API_TOKEN" -H 'Content-Type: application/json' -H "Origin: $U" -d "$1" | node -e 'const j=JSON.parse(require("fs").readFileSync(0));if(!j.ok||j.status!=="kept")console.log("  DELIVERABLES FAIL",process.argv[1],JSON.stringify(j).slice(0,200));else console.log("  DELIVERABLES ok",process.argv[1],j.bytes)' "$2"; }
for n in "$@"; do pretty=$(echo "$n" | tr '-' ' ' | sed 's/\b\(.\)/\u\1/g')
  cp -p $O/bg-$n-3840x2160.png $D/seasons/; cmp -s $O/bg-$n-3840x2160.png $D/seasons/bg-$n-3840x2160.png || { echo "COPY MISMATCH $n"; exit 1; }
  reg "{\"id\":\"litedesignz-season-bg-$n-3840x2160\",\"agentId\":\"webdesigner\",\"runId\":\"$RID\",\"path\":\"seasons/bg-$n-3840x2160.png\",\"kind\":\"image\",\"title\":\"LiteDesignz seasonal slideshow backgrounds — $pretty (3840x2160)\",\"summary\":\"Owner's Higgsfield image, centred 16:9 crop by Claude Code, Lanczos. Draft; not published.\"}" "bg-$n"
  reg "{\"id\":\"litedesignz-season-original-$n\",\"agentId\":\"webdesigner\",\"runId\":\"$RID\",\"path\":\"$n-original.png\",\"kind\":\"image\",\"title\":\"LiteDesignz seasonal slideshow backgrounds — $pretty original (4096x2323)\",\"summary\":\"Owner's Higgsfield original, unaltered. Draft; not published.\"}" "orig-$n"
done
