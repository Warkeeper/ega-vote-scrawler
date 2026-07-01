export class HourlyScheduler {
  constructor(crawler) {
    this.crawler = crawler;
    this.nextRunAt = null;
    this.timeout = null;
    this.interval = null;
  }

  start() {
    this.stop();
    this.nextRunAt = nextTopOfHour(new Date()).toISOString();
    const delay = Math.max(1000, new Date(this.nextRunAt).getTime() - Date.now());
    this.timeout = setTimeout(() => {
      void this.runScheduled();
      this.interval = setInterval(() => void this.runScheduled(), 3600000);
    }, delay);
  }

  stop() {
    if (this.timeout) clearTimeout(this.timeout);
    if (this.interval) clearInterval(this.interval);
    this.timeout = null;
    this.interval = null;
  }

  async runScheduled() {
    this.nextRunAt = new Date(Date.now() + 3600000).toISOString();
    try {
      await this.crawler.crawl('scheduled');
    } catch (error) {
      console.error('[crawler] scheduled crawl failed:', error);
    }
  }
}

export function nextTopOfHour(date) {
  const next = new Date(date);
  next.setMinutes(0, 0, 0);
  next.setHours(next.getHours() + 1);
  return next;
}
