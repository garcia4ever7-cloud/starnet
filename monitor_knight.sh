#!/bin/bash
PROJECT_ID="proj-1792964044657-xs9vyt"
OUTBOX="$HOME/outbox/$PROJECT_ID"

echo "🎬 KNIGHT PROJECT MONITOR - Background Task"
echo "Project: $PROJECT_ID"
echo "Monitoring started: $(date)"
echo ""

for i in {1..180}; do
  TIMESTAMP=$(date '+%H:%M:%S')
  
  # Check workflow file
  if [ -f ~/.local/share/StarNet/projects/$PROJECT_ID/workflow.json ]; then
    STAGE=$(jq '.currentStage' ~/.local/share/StarNet/projects/$PROJECT_ID/workflow.json 2>/dev/null)
    ATTEMPTS=$(jq '.attempts.storywriter' ~/.local/share/StarNet/projects/$PROJECT_ID/workflow.json 2>/dev/null)
    
    # Check blueprint for outputs
    if [ -f ~/.local/share/StarNet/projects/$PROJECT_ID/blueprint.json ]; then
      SCRIPT_LEN=$(jq '.outputs.storywriter.script | length' ~/.local/share/StarNet/projects/$PROJECT_ID/blueprint.json 2>/dev/null)
      SHOTLIST_LEN=$(jq '.outputs.director.shotlist | length' ~/.local/share/StarNet/projects/$PROJECT_ID/blueprint.json 2>/dev/null)
      
      echo "[$TIMESTAMP] Stage: $STAGE | Script: $SCRIPT_LEN chars | Shotlist: $SHOTLIST_LEN chars"
      
      # Check if video exists
      if [ -f "$OUTBOX/video.mp4" ]; then
        echo "🎬 ✨ VIDEO COMPLETE! $(ls -lh $OUTBOX/video.mp4 | awk '{print $5}')"
        break
      fi
      
      # Check for stage progression
      if [ "$STAGE" = "1" ] && [ "$SCRIPT_LEN" -gt "100" ]; then
        echo "✅ STORYWRITER DONE - DIRECTOR RUNNING"
      elif [ "$STAGE" = "2" ] && [ "$SHOTLIST_LEN" -gt "100" ]; then
        echo "✅ DIRECTOR DONE - PRODUCER RUNNING"
      fi
    fi
  fi
  
  sleep 10
done

echo "Monitor ended: $(date)"
