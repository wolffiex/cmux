Output screenshots/shell-hint-cwd.png

Set Width 1200
Set Height 720
Set FontSize 14
Set Theme "Dracula"
Set Padding 20

Hide
Type "bun dist/cmux.js"
Enter
Sleep 500ms
Show

# Initial state: carousel focused, shell hint shows cwd of window 1
Screenshot screenshots/shell-hint-initial.png
Sleep 100ms

# Move carousel right — shell hint should update to window 2's cwd
Type "l"
Sleep 200ms
Screenshot screenshots/shell-hint-after-l.png
Sleep 100ms

# Move back left — shell hint should revert to window 1's cwd
Type "h"
Sleep 200ms
Screenshot screenshots/shell-hint-after-h.png
Sleep 100ms

# Tab into typeahead focus to confirm hint still reflects current carousel pick
Tab
Sleep 200ms
Screenshot screenshots/shell-hint-typeahead-focus.png
Sleep 100ms
