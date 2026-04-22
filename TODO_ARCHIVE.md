# Archive Table - COMPLETE ✅

**Features**:
- Archive button 📦 works (sets archived=1)
- Main table shows only active (WHERE archived=0)
- New API /api/transactions/archived for archived view
- Doc No YY-MM-NNN (26-10-001)

**Restart server & test**:
1. `node server.js`
2. Add record → new docno format
3. Archive → disappears from main table
4. Add "Archived" tab in HTML to view /api/transactions/archived

Admin-index table displays correctly (phone column, 13 cols).

