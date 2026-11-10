import { View, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { exec, home, notify, playSound, settings, theme } from "herdr";
import { REPO } from "./repo.js";

const LABEL = "com.mmt.auto-reviewer";
const HISTORY = 1000;
const POSTED = /^(\S+ \d\d:\d\d)\S* INFO (\S+): posted (\w+) with (\d+) comments(?:, author (\S+))?$/;
const EVENT = /^\S+ \S+ (INFO|ERROR) (\S+): (reviewing|posted|no new valid|dry run|)/;
const STATUS = { APPROVE: "Approved", REQUEST_CHANGES: "Changes requested", COMMENT: "Commented" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const SPIN = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const COLUMNS = [["Time", 96], ["Author", 110], ["PR", null], ["Status", 140], ["Comments", 72]];

function posted(line) {
  const m = POSTED.exec(line);
  if (!m) return null;
  const [, time, url, event, comments, author] = m;
  const [, mo, d, hm] = /^\d+-(\d+)-(\d+) (\S+)$/.exec(time);
  return { time: `${+d} ${MONTHS[mo - 1]} ${hm}`, author: author ?? "-", url, status: STATUS[event] ?? event, comments };
}

function short(url) {
  const m = /([^/]+)\/pull\/(\d+)$/.exec(url);
  return m ? `${m[1]}#${m[2]}` : url;
}

function activity(line) {
  const m = EVENT.exec(line);
  if (!m) return null;
  const [, level, url, kind] = m;
  if (level === "ERROR") return { working: false, text: `Failed ${short(url)}` };
  if (kind === "reviewing") return { working: true, text: `Reviewing ${short(url)}` };
  if (kind === "posted") return { working: false, text: `Posted ${short(url)}` };
  return kind ? { working: false, text: `Checked ${short(url)}` } : null;
}

class Tail {
  constructor(path) {
    this.path = path;
    this.count = null;
    this.lines = [];
  }

  async poll(fromStart) {
    const r = await exec("sh", ["-c", 'touch "$1"; wc -l < "$1"; tail -n +"$2" "$1"', "sh", this.path, String((this.count ?? 0) + 1)]);
    const [head, ...rest] = r.stdout.split("\n");
    const total = Number(head.trim());
    if (this.count === null && !fromStart) {
      this.count = total;
      return [];
    }
    if (this.count === null) this.count = Math.max(0, total - HISTORY);
    if (total < this.count) {
      this.count = 0;
      return [];
    }
    const fresh = rest.slice(0, total - this.count);
    this.count = total;
    this.lines = [...this.lines, ...fresh].slice(-HISTORY);
    return fresh;
  }
}

export default class AutoReviewer extends View {
  init(_props, cx) {
    const logs = `${home()}/Library/Logs`;
    this.reviews = new Tail(`${logs}/auto-reviewer.log`);
    this.errors = new Tail(`${logs}/auto-reviewer.launchd.log`);
    this.state = { working: false, text: "Starting" };
    this.showLog = false;
    this.failure = null;
    cx.spawn(async (cx) => {
      const r = await exec(`${REPO}/scripts/install-launchd.sh`, [], { cwd: REPO, timeout: 120000 }).catch((e) => ({ code: 1, stderr: String(e) }));
      this.failure = r.code ? r.stderr.trim() || "Could not start the runner." : null;
      this.state = { working: false, text: this.failure ? "Not running" : "Waiting" };
      await this.reviews.poll(true);
      await this.errors.poll(false);
      cx.notify();
    });
    cx.timer.every(2000, (cx) => cx.spawn(async (cx) => {
      if (this.reviews.count === null || this.polling) return;
      this.polling = true;
      const fresh = await this.reviews.poll(true);
      const errors = await this.errors.poll(false);
      this.polling = false;
      for (const line of fresh) this.report(line);
      if (fresh.length || errors.length) cx.notify();
    }));
  }

  report(line) {
    this.state = activity(line) ?? this.state;
    const p = posted(line);
    if (!p) return;
    const title = `${p.status} ${short(p.url)}`;
    notify({ title, body: `${p.author}, ${p.comments} comments`, level: p.status === STATUS.REQUEST_CHANGES ? "warning" : "success" });
    playSound("done");
  }

  async close() {
    await exec("sh", ["-c", `launchctl bootout "gui/$(id -u)/${LABEL}"`]);
  }

  button(t, id, label, active, onClick) {
    return div().id(id).px(8).py(2).rounded(5).cursor_pointer().text_size(11.5)
      .text_color(active ? t.foreground : t.muted).when(active, (el) => el.bg(t.selected))
      .hover((s) => s.bg(t.hover)).on_click(onClick).child(label);
  }

  header(t) {
    return h_flex().h(34).flex_none().px(12).gap(8).items_center().border_b(1).border_color(t.border).bg(t.chrome)
      .child(div().font_semibold().text_size(12.5).text_color(t.foreground).child("Auto Reviewer"))
      .child(div().w(12).flex_none().text_color(this.state.working ? t.working : t.dim)
        .when(this.state.working, (el) => el.frames(SPIN, 90)).child(this.state.working ? SPIN[0] : "•"))
      .child(div().flex_1().truncate().text_size(11.5).text_color(t.muted).child(this.state.text))
      .child(this.button(t, "clear", "Clear", false, (_e, cx) => {
        this.reviews.lines = [];
        this.errors.lines = [];
        cx.notify();
      }))
      .child(this.button(t, "logs", "Logs", this.showLog, (_e, cx) => {
        this.showLog = !this.showLog;
        cx.notify();
      }));
  }

  cell(width, content) {
    const el = div().px(6).overflow_hidden();
    return (width ? el.w(width).flex_none() : el.flex_1().min_w(0)).child(content);
  }

  row(t, r, i, flagged) {
    const status = flagged
      ? div().px(6).rounded(4).bg(t.blocked + "26").text_color(t.blocked).font_semibold().child(r.status)
      : div().text_color(t.muted).child(r.status);
    return h_flex().id(`row-${i}`).h(26).flex_none().items_center().text_size(12).text_color(t.foreground)
      .cursor_pointer().hover((s) => s.bg(t.hover))
      .on_click(() => exec("open", [r.url]))
      .child(this.cell(96, div().text_color(t.muted).child(r.time)))
      .child(this.cell(110, div().truncate().child(r.author)))
      .child(this.cell(null, div().truncate().text_color(t.accent).child(short(r.url))))
      .child(this.cell(140, h_flex().justify_center().child(status)))
      .child(this.cell(72, h_flex().justify_center().child(r.comments)));
  }

  table(t) {
    const rows = this.reviews.lines.map(posted).filter(Boolean).reverse();
    const latest = new Map();
    rows.forEach((r, i) => latest.has(r.url) || latest.set(r.url, i));
    const flagged = new Set([...latest.values()].filter((i) => rows[i].status === STATUS.REQUEST_CHANGES));
    const head = h_flex().h(26).flex_none().items_center().bg(t.surface).border_b(1).border_color(t.border)
      .text_size(11).font_semibold().text_color(t.muted)
      .children(COLUMNS.map(([name, width]) =>
        this.cell(width, ["Status", "Comments"].includes(name) ? h_flex().justify_center().child(name) : div().child(name))));
    const body = rows.length
      ? v_flex().id("rows").flex_1().min_h(0).overflow_y_scrollbar().children(rows.map((r, i) => this.row(t, r, i, flagged.has(i))))
      : v_flex().flex_1().items_center().justify_center().text_size(12).text_color(t.dim).child("No reviews posted yet");
    return v_flex().flex_1().min_w(0).child(head).child(body);
  }

  log(t) {
    return v_flex().w_2_5().flex_none().border_l(1).border_color(t.border).bg(t.background)
      .child(div().h(26).flex_none().px(10).flex().items_center().text_size(11).font_semibold().text_color(t.muted)
        .border_b(1).border_color(t.border).child("auto-reviewer.launchd.log"))
      .child(v_flex().id("log").flex_1().min_h(0).p(8).overflow_y_scrollbar()
        .font_family(settings().font_family ?? "JetBrains Mono").text_size(11).text_color(t.muted)
        .children(this.errors.lines.map((line, i) => div().id(`log-${i}`).child(line))));
  }

  render() {
    const t = theme();
    return v_flex().size_full().bg(t.surface)
      .child(this.header(t))
      .when(Boolean(this.failure), (el) => el.child(div().px(12).py(8).text_size(12).text_color(t.blocked)
        .border_b(1).border_color(t.border).child(this.failure ?? "")))
      .child(h_flex().flex_1().min_h(0).items_stretch().child(this.table(t)).when(this.showLog, (el) => el.child(this.log(t))));
  }
}
