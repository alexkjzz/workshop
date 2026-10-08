"""Require consecutive analyzed frames before confirming human presence."""

from collections.abc import Iterable

from app.schemas.vision import DetectedObject


class PresenceConfirmation:
    """Use stable track IDs when available, otherwise consecutive detections."""

    def __init__(self, required_frames: int = 3) -> None:
        self.required_frames = max(1, required_frames)
        self._untracked_streak = 0
        self._track_streaks: dict[int, int] = {}

    def update(self, objects: Iterable[DetectedObject]) -> bool:
        people = list(objects)
        if not people:
            self.reset()
            return False

        ids = {person.track_id for person in people if person.track_id is not None}
        if ids:
            self._untracked_streak = 0
            self._track_streaks = {
                track_id: self._track_streaks.get(track_id, 0) + 1
                for track_id in ids
            }
            return any(count >= self.required_frames for count in self._track_streaks.values())

        self._track_streaks.clear()
        self._untracked_streak += 1
        return self._untracked_streak >= self.required_frames

    def reset(self) -> None:
        self._untracked_streak = 0
        self._track_streaks.clear()
