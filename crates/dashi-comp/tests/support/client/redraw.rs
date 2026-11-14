//! Drawing a test window again, for tests that wait on its next frame.

use super::Client;

impl Client {
    /// Draw the window again: a new buffer, committed.
    pub fn redraw(&mut self) {
        self.state.drawn = false;
        let qh = self.queue.handle();
        self.state.draw(&qh);
        self.queue.flush().ok();
    }
}
