import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import {
  RefreshCw,
  Shield,
  Search,
  Clock,
  ChevronDown
} from "lucide-react";
import { Input } from "@/components/ui/input";

interface RosterEntry {
  id: string;
  user_id: string;
  username: string;
  avatar_url?: string;
  checked_in_at: string;
  checked_out_at?: string;
  duration_mins?: number;
  duty_type: string;
  role?: string;
  role_color?: string;
  notes?: string;
}

function formatDuration(mins?: number) {
  if (!mins) return "—";

  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);

  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function MemberAvatar({ entry }: { entry: RosterEntry }) {
  const name = entry.username || "?";

  if (entry.avatar_url) {
    return (
      <div className="relative flex-shrink-0 w-9 h-9">
        <img
          src={entry.avatar_url}
          alt={name}
          className="w-9 h-9 rounded-full object-cover border border-border"
          onError={(e: any) => {
            e.target.style.display = "none";

            const fallback =
              e.target.parentNode?.querySelector(".avfb");

            if (fallback) {
              fallback.style.display = "flex";
            }
          }}
        />

        <div
          className="avfb w-9 h-9 rounded-full bg-muted border border-border items-center justify-center text-sm font-bold text-muted-foreground absolute inset-0"
          style={{ display: "none" }}
        >
          {name[0].toUpperCase()}
        </div>
      </div>
    );
  }

  return (
    <div className="w-9 h-9 rounded-full bg-muted border border-border flex items-center justify-center text-sm font-bold text-muted-foreground flex-shrink-0">
      {name[0].toUpperCase()}
    </div>
  );
}

function RosterPopup({
  entry,
  onClose
}: {
  entry: RosterEntry;
  onClose: () => void;
}) {
  const isActive = !entry.checked_out_at;

  const elapsed = isActive
    ? Math.round(
        (Date.now() -
          new Date(entry.checked_in_at).getTime()) /
          60000
      )
    : entry.duration_mins;

  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <MemberAvatar entry={entry} />

            <div>
              <p className="font-bold text-base">
                {entry.username}
              </p>

              <p className="text-xs text-muted-foreground font-normal">
                {isActive ? (
                  <span className="flex items-center gap-1 text-green-600">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block animate-pulse" />
                    Currently on duty
                  </span>
                ) : (
                  "Off duty"
                )}
              </p>
            </div>
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3 text-sm mt-2">

          {/* Duty Type */}
          <div>
            <p className="text-xs text-muted-foreground font-medium mb-0.5">
              Duty Type
            </p>

            <p className="capitalize text-black dark:text-black font-medium">
              {entry.duty_type ||
                entry.role ||
                "General"}
            </p>
          </div>

          {/* Role */}
          {entry.role && (
            <div>
              <p className="text-xs text-muted-foreground font-medium mb-0.5">
                Role
              </p>

              <p className="text-black dark:text-black font-medium">
                {entry.role}
              </p>
            </div>
          )}

          {/* Duration */}
          <div>
            <p className="text-xs text-muted-foreground font-medium mb-0.5">
              Duration
            </p>

            <p className="font-mono font-semibold">
              {formatDuration(elapsed)}
            </p>
          </div>

          {/* Checked In */}
          <div>
            <p className="text-xs text-muted-foreground font-medium mb-0.5">
              Checked In
            </p>

            <p>
              {new Date(
                entry.checked_in_at
              ).toLocaleString()}
            </p>
          </div>

          {/* Checked Out */}
          {entry.checked_out_at && (
            <div>
              <p className="text-xs text-muted-foreground font-medium mb-0.5">
                Checked Out
              </p>

              <p>
                {new Date(
                  entry.checked_out_at
                ).toLocaleString()}
              </p>
            </div>
          )}

          {/* Notes */}
          {entry.notes && (
            <div className="col-span-2">
              <p className="text-xs text-muted-foreground font-medium mb-0.5">
                Notes
              </p>

              <p className="bg-muted/30 rounded-lg p-2 border">
                {entry.notes}
              </p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RosterRow({
  entry,
  onClick
}: {
  entry: RosterEntry;
  onClick: () => void;
}) {
  const isActive = !entry.checked_out_at;

  const elapsed = isActive
    ? Math.round(
        (Date.now() -
          new Date(entry.checked_in_at).getTime()) /
          60000
      )
    : entry.duration_mins;

  return (
    <button
      onClick={onClick}
      className="w-full text-left"
    >
      <div className="border border-border rounded-lg overflow-hidden mb-2 hover:border-amber-200 hover:shadow-sm transition-all">

        <div className="w-full flex items-center gap-3 px-4 py-3 bg-card hover:bg-muted/20 transition-colors">

          <MemberAvatar entry={entry} />

          {/* Online Status */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {isActive ? (
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            ) : (
              <div className="w-2 h-2 rounded-full bg-gray-300" />
            )}
          </div>

          {/* Member */}
          <div className="flex-1 min-w-0">

            <span className="font-semibold text-sm">
              {entry.username}
            </span>

            {/* Selected Role / Duty Type */}
            {entry.duty_type &&
              entry.duty_type !== "general" && (
                <span className="text-black dark:text-black text-xs ml-2 capitalize font-medium">
                  [{entry.duty_type}]
                </span>
              )}

            {/* Actual Role */}
            {entry.role && (
              <span className="text-black dark:text-black text-xs ml-2 font-medium">
                [{entry.role}]
              </span>
            )}

          </div>

          {/* Status / Duration */}
          <div className="flex items-center gap-2 flex-shrink-0">

            {isActive ? (
              <Badge className="bg-green-100 text-green-700 border-green-200 text-xs">
                On Duty
              </Badge>
            ) : (
              <Badge className="bg-gray-100 text-gray-500 border text-xs">
                Checked Out
              </Badge>
            )}

            <span className="font-mono text-sm">
              {formatDuration(elapsed)}
            </span>

            <ChevronDown
              size={14}
              className="text-muted-foreground -rotate-90"
            />

          </div>

        </div>
      </div>
    </button>
  );
}

export default function RosterPage({
  guildId
}: {
  guildId: string;
}) {
  const [entries, setEntries] =
    useState<RosterEntry[]>([]);

  const [historyEntries, setHistoryEntries] =
    useState<RosterEntry[]>([]);

  const [loading, setLoading] =
    useState(true);

  const [search, setSearch] =
    useState("");

  const [showHistory, setShowHistory] =
    useState(false);

  const [selectedEntry, setSelectedEntry] =
    useState<RosterEntry | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);

    try {
      const [activeRes, histRes] =
        await Promise.all([
          fetch(
            `/api/guilds/${guildId}/roster`,
            {
              credentials: "include"
            }
          ),

          fetch(
            `/api/guilds/${guildId}/roster/history`,
            {
              credentials: "include"
            }
          )
        ]);

      if (activeRes.ok) {
        const activeData = await activeRes.json();

        setEntries(
          Array.isArray(activeData)
            ? activeData
            : []
        );
      } else {
        setEntries([]);
      }

      if (histRes.ok) {
        const historyData =
          await histRes.json();

        setHistoryEntries(
          Array.isArray(historyData)
            ? historyData
            : []
        );
      } else {
        setHistoryEntries([]);
      }
    } catch (error) {
      console.error(
        "Failed to fetch roster data:",
        error
      );

      setEntries([]);
      setHistoryEntries([]);
    }

    setLoading(false);
  }, [guildId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const active = entries.filter(
    (e) => !e.checked_out_at
  );

  const history = historyEntries.filter(
    (e) => !!e.checked_out_at
  );

  const displayed = showHistory
    ? history
    : active;

  const filtered = displayed.filter(
    (e) =>
      !search ||
      e.username
        .toLowerCase()
        .includes(search.toLowerCase())
  );

  const today = new Date().toDateString();

  const sessionsToday = history.filter(
    (e) =>
      new Date(
        e.checked_in_at
      ).toDateString() === today
  ).length;

  const totalDutyToday = history
    .filter(
      (e) =>
        new Date(
          e.checked_in_at
        ).toDateString() === today
    )
    .reduce(
      (s, e) =>
        s + (e.duration_mins || 0),
      0
    );

  return (
    <div className="space-y-5 max-w-4xl">

      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">

        <div>
          <h2 className="text-2xl font-extrabold tracking-tight flex items-center gap-2">
            <Shield
              className="w-6 h-6"
              style={{ color: "#d4af37" }}
            />

            Duty Roster
          </h2>

          <p className="text-muted-foreground mt-0.5 text-sm">
            {active.length} staff currently on duty
            — click any row for details
          </p>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={fetchData}
          className="gap-1.5"
        >
          <RefreshCw size={13} />
          Refresh
        </Button>

      </div>

      {/* Statistics */}
      <div className="grid grid-cols-3 gap-3">

        <Card>
          <CardContent className="p-3 text-center">
            <p className="text-2xl font-bold text-green-600">
              {active.length}
            </p>

            <p className="text-xs text-muted-foreground">
              On Duty Now
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-3 text-center">
            <p className="text-2xl font-bold">
              {sessionsToday}
            </p>

            <p className="text-xs text-muted-foreground">
              Sessions Today
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-3 text-center">
            <p className="text-2xl font-bold">
              {formatDuration(totalDutyToday)}
            </p>

            <p className="text-xs text-muted-foreground">
              Duty Hours Today
            </p>
          </CardContent>
        </Card>

      </div>

      {/* Search / History */}
      <div className="flex gap-2">

        <div className="relative flex-1">

          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />

          <Input
            placeholder="Search staff..."
            value={search}
            onChange={(e) =>
              setSearch(e.target.value)
            }
            className="pl-9 h-9 text-sm"
          />

        </div>

        <Button
          variant={
            showHistory
              ? "default"
              : "outline"
          }
          size="sm"
          onClick={() =>
            setShowHistory((h) => !h)
          }
          className="gap-1.5"
          style={
            showHistory
              ? {
                  background: "#d4af37",
                  color: "#000"
                }
              : {}
          }
        >
          <Clock size={13} />

          {showHistory
            ? "Showing History"
            : "Show History"}
        </Button>

      </div>

      {/* Empty Active Roster */}
      {!showHistory &&
        active.length === 0 &&
        !loading && (
          <Card>
            <CardContent className="py-10 text-center">

              <Shield
                size={32}
                className="mx-auto text-muted-foreground mb-2 opacity-30"
              />

              <p className="text-muted-foreground text-sm">
                No staff currently on duty.
              </p>

              <p className="text-xs text-muted-foreground mt-1">
                Staff check in via /roster
                check-in in Discord.
              </p>

            </CardContent>
          </Card>
        )}

      {/* Loading */}
      {loading ? (
        <div className="flex justify-center py-16">

          <div
            className="w-7 h-7 rounded-full border-2 border-t-transparent animate-spin"
            style={{
              borderColor: "#d4af37",
              borderTopColor: "transparent"
            }}
          />

        </div>
      ) : filtered.length > 0 ? (
        <div>
          {filtered.map((entry) => (
            <RosterRow
              key={entry.id}
              entry={entry}
              onClick={() =>
                setSelectedEntry(entry)
              }
            />
          ))}
        </div>
      ) : showHistory ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground text-sm">
            No duty history found.
          </CardContent>
        </Card>
      ) : null}

      {/* Details Popup */}
      {selectedEntry && (
        <RosterPopup
          entry={selectedEntry}
          onClose={() =>
            setSelectedEntry(null)
          }
        />
      )}

    </div>
  );
}
