import React, { useState, useEffect, useMemo } from 'react';

export function CalendarPanel() {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [events, setEvents] = useState<Array<{id: number, title: string, start_time: string, end_time?: string, description?: string}>>([]);
  const [showModal, setShowModal] = useState(false);
  const [eventForm, setEventForm] = useState({ title: '', start: '', end: '', description: '' });

  useEffect(() => {
    loadEvents();
  }, [currentMonth]);

  const loadEvents = async () => {
    try {
      // @ts-ignore
      const dateStr = currentMonth.toISOString().split('T')[0].substring(0, 7);
      const data = await window.api.calendar.list(dateStr);
      setEvents(data);
    } catch (e) {
      console.error('Failed to load events:', e);
    }
  };

  const handleAddEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      // @ts-ignore
      await window.api.calendar.add(eventForm.title, eventForm.start, eventForm.end, eventForm.description);
      setShowModal(false);
      setEventForm({ title: '', start: '', end: '', description: '' });
      loadEvents();
    } catch (err) {
      console.error('Failed to add event:', err);
    }
  };

  const daysInMonth = useMemo(() => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const prevMonthDays = new Date(year, month, 0).getDate();
    
    const days: Array<{day: number, isCurrent: boolean, isToday: boolean, events: any[]}> = [];
    
    // Previous month days
    for (let i = firstDay - 1; i >= 0; i--) {
      const day = prevMonthDays - i;
      const dateStr = new Date(year, month - 1, day).toISOString().split('T')[0];
      days.push({
        day,
        isCurrent: false,
        isToday: false,
        events: events.filter(ev => ev.start_time.startsWith(dateStr))
      });
    }
    
    // Current month days
    const today = new Date();
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = new Date(year, month, d).toISOString().split('T')[0];
      days.push({
        day: d,
        isCurrent: true,
        isToday: today.getFullYear() === year && today.getMonth() === month && today.getDate() === d,
        events: events.filter(ev => ev.start_time.startsWith(dateStr))
      });
    }
    
    // Next month days to fill grid
    const totalCells = Math.ceil(days.length / 7) * 7;
    for (let d = 1; days.length < totalCells; d++) {
      const dateStr = new Date(year, month + 1, d).toISOString().split('T')[0];
      days.push({
        day: d,
        isCurrent: false,
        isToday: false,
        events: events.filter(ev => ev.start_time.startsWith(dateStr))
      });
    }
    
    return days;
  }, [currentMonth, events]);

  const handleNewEvent = (date?: Date) => {
    const defaultDate = date || new Date();
    const start = defaultDate.toISOString().slice(0, 16);
    setEventForm({ title: '', start, end: '', description: '' });
    setShowModal(true);
  };

  const formatMonth = (date: Date) => {
    return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  };

  return (
    <div className="panel calendar-panel">
      <div className="panel-header">
        <div className="calendar-header">
          <div>
            <h1 className="panel-title">{formatMonth(currentMonth)}</h1>
            <p className="panel-subtitle">Manage your schedule</p>
          </div>
          <div style={{display: 'flex', gap: '8px', alignItems: 'center'}}>
            <button className="icon-btn" onClick={() => setCurrentMonth(prev => new Date(prev.getFullYear(), prev.getMonth() - 1))} title="Previous month">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="15 18 9 12 15 6"/>
              </svg>
            </button>
            <button className="icon-btn" onClick={() => setCurrentMonth(new Date())} title="Today">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                <line x1="16" y1="2" x2="16" y2="6"/>
                <line x1="8" y1="2" x2="8" y2="6"/>
                <line x1="3" y1="10" x2="21" y2="10"/>
              </svg>
            </button>
            <button className="icon-btn" onClick={() => setCurrentMonth(prev => new Date(prev.getFullYear(), prev.getMonth() + 1))} title="Next month">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            </button>
            <button className="btn btn-primary" onClick={handleNewEvent} style={{padding: '8px 16px', fontSize: '13px'}}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{marginRight: '6px', verticalAlign: 'middle'}}>
                <line x1="12" y1="5" x2="12" y2="19"/>
                <line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              Add Event
            </button>
          </div>
        </div>
      </div>

      <div className="calendar-grid">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, i) => (
          <div key={i} className="calendar-day-header">{day}</div>
        ))}
        {daysInMonth.map((d, i) => (
          <div
            key={i}
            className={`calendar-day ${d.isCurrent ? '' : 'other-month'} ${d.isToday ? 'today' : ''}`}
            onClick={() => d.isCurrent && handleNewEvent(new Date(currentMonth.getFullYear(), currentMonth.getMonth(), d.day))}
            style={{cursor: d.isCurrent ? 'pointer' : 'default'}}
          >
            <div className="calendar-day-number">{d.day}</div>
            {d.events.slice(0, 3).map(ev => (
              <div key={ev.id} className="calendar-event" onClick={e => e.stopPropagation()}>
                {ev.start_time.slice(11, 16)} {ev.title}
              </div>
            ))}
            {d.events.length > 3 && (
              <div className="calendar-event" style={{background: 'var(--border)', borderColor: 'var(--border)', color: 'var(--fg-muted)'}}>
                +{d.events.length - 3} more
              </div>
            )}
          </div>
        ))}
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2 className="modal-title">New Event</h2>
            <form onSubmit={handleAddEvent}>
              <div className="form-group">
                <label className="form-label">Title</label>
                <input
                  type="text"
                  className="settings-input"
                  value={eventForm.title}
                  onChange={e => setEventForm(prev => ({ ...prev, title: e.target.value }))}
                  placeholder="Event title"
                  required
                  autoFocus
                />
              </div>
              <div className="form-group">
                <label className="form-label">Start</label>
                <input
                  type="datetime-local"
                  className="settings-input"
                  value={eventForm.start}
                  onChange={e => setEventForm(prev => ({ ...prev, start: e.target.value }))}
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label">End (optional)</label>
                <input
                  type="datetime-local"
                  className="settings-input"
                  value={eventForm.end}
                  onChange={e => setEventForm(prev => ({ ...prev, end: e.target.value }))}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Description</label>
                <textarea
                  className="form-textarea"
                  value={eventForm.description}
                  onChange={e => setEventForm(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="Event details..."
                  rows={3}
                />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Create Event</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}