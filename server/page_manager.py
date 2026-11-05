"""Animated, lightweight page container for Tkinter applications."""

import tkinter as tk


class PageManager(tk.Frame):
    """A stacked Tkinter page container with a short slide transition."""

    def __init__(self, parent, duration_ms=130, direction="right", **kwargs):
        super().__init__(parent, **kwargs)
        if direction not in ("right", "left"):
            raise ValueError("direction must be 'right' or 'left'")
        self.duration_ms = max(0, int(duration_ms))
        self.direction = direction
        self._pages = []
        self._index = -1
        self._padding = (0, 0, 0, 0)
        self._after_id = None
        self._animation = None
        self._shown = set()

    @property
    def pages(self):
        return tuple(self._pages)

    @property
    def index(self):
        return self._index

    @property
    def current(self):
        return self._pages[self._index] if self._index >= 0 else None

    def add(self, frame, text=None):
        del text
        if frame in self._pages:
            return frame
        self._pages.append(frame)
        self._place(frame, 0)
        if self._index < 0:
            self._index = 0
            frame.tkraise()
        else:
            frame.lower()
        return frame

    def index_of(self, frame):
        try:
            return self._pages.index(frame)
        except ValueError:
            return -1

    def select_widget(self, frame):
        self.select(frame)

    def select(self, page):
        target = page if isinstance(page, int) else self.index_of(page)
        if not 0 <= target < len(self._pages):
            raise IndexError("page index out of range")
        if target == self._index and self._animation is None:
            self._pages[target].tkraise()
            return
        self._stop_animation()
        old_index = self._index
        self._index = target
        new_page = self._pages[target]
        first_show = target not in self._shown
        self._shown.add(target)
        if old_index < 0:
            self._place(new_page, 0)
            new_page.tkraise()
            return
        if first_show:
            # A page is laid out the first time it is mapped. Sliding it in while
            # Tk is still measuring widgets makes the content jump and re-flow,
            # so the first visit swaps instantly and later visits animate.
            for frame in self._pages:
                self._place(frame, 0)
            new_page.tkraise()
            return
        old_page = self._pages[old_index]
        old_page.tkraise()
        distance = max(1, int(round(24 * self.winfo_fpixels("1i") / 96)))
        start = distance if self.direction == "right" else -distance
        self._place(new_page, start)
        new_page.tkraise()
        self._animation = (old_page, new_page, start, 0, 0)
        self._animate()

    def configure_padding(self, padding=0):
        if isinstance(padding, int):
            values = (padding,) * 4
        else:
            values = tuple(padding)
            if len(values) == 2:
                values = (values[0], values[1], values[0], values[1])
            elif len(values) != 4:
                raise ValueError("padding must be an int, 2-tuple, or 4-tuple")
        if any(value < 0 for value in values):
            raise ValueError("padding cannot be negative")
        self._padding = tuple(int(value) for value in values)
        for frame in self._pages:
            self._place(frame, 0)

    def _place(self, frame, offset):
        left, top, right, bottom = self._padding
        frame.place(in_=self, x=left + offset, y=top, relwidth=1, relheight=1,
                    width=-(left + right), height=-(top + bottom))

    def _stop_animation(self):
        if self._after_id is not None:
            self.after_cancel(self._after_id)
            self._after_id = None
        if self._animation is not None:
            old_page, new_page, _, _, _ = self._animation
            self._place(old_page, 0)
            self._place(new_page, 0)
            self._animation = None

    def _animate(self):
        if self._animation is None:
            return
        old_page, new_page, start, end, frame_no = self._animation
        frame_count = 8
        frame_no += 1
        progress = min(1.0, frame_no / frame_count)
        eased = 1.0 - (1.0 - progress) ** 3
        self._place(new_page, round(start + (end - start) * eased))
        new_page.tkraise()
        self._animation = (old_page, new_page, start, end, frame_no)
        if progress >= 1.0:
            self._place(old_page, 0)
            self._place(new_page, 0)
            self._animation = None
            self._after_id = None
            return
        self._after_id = self.after(max(1, self.duration_ms // frame_count), self._animate)


__all__ = ["PageManager"]
