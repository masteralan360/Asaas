## 🧠 Brainstorm: Reducing Supabase Sync Spam

### Context
The `p2pSyncManager` currently performs a full "pull" query of the `sync_queue` table every time the app initializes (on refresh or session start). If many users do this frequently, it creates unnecessary load on Supabase.

---

### Option A: Last-Sync Timestamp Filtering
Store the timestamp of the last successful sync in the local database or `localStorage`. When the app starts, only fetch items where `created_at > last_sync_time`.

✅ **Pros:**
- Drastically reduces the number of rows scanned by Supabase.
- Prevents re-fetching metadata for items already processed.

❌ **Cons:**
- Requires reliable local state management.
- Risk of missing items if the system clock drifts significantly between clients.

📊 **Effort:** Medium

---

### Option B: Initialization Debouncing
Implementing a "Global Lock" or cooldown period (e.g., 5 minutes) where the app will not perform another heavy `checkPendingDownloads` if it has already successfully completed one recently.

✅ **Pros:**
- Extremely easy to implement.
- Prevents "refresh spamming" from hitting the database every single time.

❌ **Cons:**
- If a new file was uploaded while the app was closed and then opened within the cooldown, the user might have to wait for the realtime event or next cycle.

📊 **Effort:** Low

---

### Option C: Adaptive Polling/Pulling
Rely entirely on Supabase Realtime for "live" updates and only perform the "full pull" if the Realtime connection has been interrupted or on the very first boot of the day.

✅ **Pros:**
- Cleanest architecture: Realtime handles the heavy lifting.
- Almost zero extra queries during typical usage.

❌ **Cons:**
- Realtime can sometimes miss events during network jitter; the "full pull" is the safety net. Removing it entirely is risky.

📊 **Effort:** High

---

## 💡 Recommendation

**Option A + B (Hybrid approach)**: 
1. Add a **5-second debounce** to the `initialize` method to prevent rapid-fire calls during React re-renders.
2. Store `last_sync_timestamp` locally.
3. Update the query to only fetch items newer than that timestamp.

This ensures that even if a user refreshes 10 times, the database only looks for *new* items since the last time they successfully synced.

What direction would you like to explore?
