Output screenshots/layout-order.png

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

# Enter layout picker (Enter on current window from carousel)
Enter
Sleep 300ms

# Screenshot: should show current layout at position 1/10
Screenshot screenshots/layout-order-0-start.png
Sleep 100ms

# Advance once — should show the top-ranked destination (both stacked, 4 panes)
# rather than the next static-order layout (left + right with bottom, 3 panes)
Type "l"
Sleep 200ms
Screenshot screenshots/layout-order-1-after-l.png
Sleep 100ms

# Advance again
Type "l"
Sleep 200ms
Screenshot screenshots/layout-order-2-after-ll.png
Sleep 100ms
