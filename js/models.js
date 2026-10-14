// Resource objects. Each keeps every field the API sent, under the API's own
// names (so code written against plain answers keeps working), adds
// camelCase getters, and has methods for what you do with it next.
// .raw is the answer as it came; JSON.stringify gives the same.

const CLIENT = Symbol("simmail.client");

export class Resource {
  constructor(client, data) {
    Object.defineProperty(this, CLIENT, { value: client });
    Object.defineProperty(this, "raw", { value: data || {} });
    // Own data properties (not assignment): a field may share a getter's name.
    for (const [k, v] of Object.entries(data || {})) Object.defineProperty(this, k, { value: v, enumerable: true, writable: true, configurable: true });
  }
  /** The client this came from. */
  get client() { return this[CLIENT]; }
  toJSON() { return this.raw; }
}

const re = s => (/^re:/i.test(s || "") ? s : `Re: ${s || ""}`);

/** An email in a mailbox. From waits, lists and reads. */
export class Message extends Resource {
  /** @param ctx {address, folder} where it is, when the answer does not say */
  constructor(client, data, ctx = {}) {
    super(client, data);
    if (this.address === undefined && ctx.address) Object.defineProperty(this, "address", { value: ctx.address, enumerable: false, writable: true });
    if (this.folder === undefined && ctx.folder) Object.defineProperty(this, "folder", { value: ctx.folder, enumerable: false, writable: true });
  }
  get messageId() { return this.message_id; }
  get inReplyTo() { return this.in_reply_to; }
  get fromName() { return this.from_name; }
  /** One-time codes found in the text (wait results; extract() for others). */
  get codes() { return this.raw.codes || []; }
  /** Links that verify, confirm, reset or sign in. */
  get magicLinks() { return this.raw.magic_links || []; }
  /** Written by a simulated person. */
  get byPersona() { return !!(this.raw.by_persona || (this.raw.headers && this.raw.headers["x-simmail-simulated"])); }
  get isRead() { return (this.raw.flags || []).includes("\\Seen"); }
  /** How long the wait that found it took (wait results). */
  get waitedMs() { return this.waited_ms; }

  #where() {
    if (!this.address || !this.folder || this.uid === undefined) throw new Error("this message does not say which mailbox, folder and uid it is in");
    return [this.address, this.folder, this.uid];
  }

  /** The whole message (lists cut the text short), with .safe HTML and the .case it belongs to. */
  async full(opts) { const r = await this.client.message(...this.#where(), opts); return r.message; }
  /** The original RFC 5322 source. */
  source() { return this.client.rawMessage(...this.#where()); }
  /** Attachment number n (from 0), as bytes. */
  attachment(n) { return this.client.attachment(...this.#where(), n); }
  /** Codes and links in this message, for messages that do not carry them. */
  extract() { return this.client.extract({ text: this.text, html: this.html }); }
  markRead() { return this.client.updateMessage(...this.#where(), { seen: true }); }
  markUnread() { return this.client.updateMessage(...this.#where(), { seen: false }); }
  /** Moves it to another folder, as a mail client would. */
  move(folder) { return this.client.updateMessage(...this.#where(), { moveTo: folder }); }

  /**
   * Answers this message, threaded: from the mailbox it is in (or opts.from),
   * to its sender, "Re: subject". opts: text, html, cc, attachments, from.
   */
  reply({ from, text, html, cc, attachments } = {}) {
    const refs = [...(this.raw.references || []), this.message_id].filter(Boolean);
    return this.client.send({ from: from || this.address || (this.to || [])[0], to: [this.from], cc, subject: re(this.subject), text, html, attachments, inReplyTo: this.message_id, references: refs });
  }
  /** Waits for the reply to this message from its (first) recipient, or opts.from. */
  waitForReply(opts = {}) { return this.client.waitForReply({ from: (this.to || [])[0], ...opts, inReplyTo: this.message_id }); }
  /** The health report of this message, when your app sent it. */
  health() { return this.client.health(this.message_id); }
  /** Its conversation, once nothing new has joined it for opts.quiet (default "10s"). */
  waitUntilQuiet(opts = {}) { return this.client.waitForThread({ ...opts, messageId: this.message_id }); }
}

/** A mailbox: your app's login or a person's address. */
export class Mailbox extends Resource {
  get personaId() { return this.persona_id; }
  get displayName() { return this.display_name; }
  get canLogin() { return this.can_login; }

  /** Its messages in a folder (default INBOX), newest first, as an async iterator. */
  async *messages({ folder } = {}) { for (const m of await this.list({ folder })) yield m; }
  /** Its messages in a folder, newest first, as an array. */
  list({ folder } = {}) { return this.client.messages(this.address, { folder }); }
  /** The next email to this address. Same options as waitForEmail, without to. */
  waitForEmail(opts = {}) { return this.client.waitForEmail({ ...opts, to: this.address }); }
  folders() { return this.client.folders(this.address); }
  threads() { return this.client.threads(this.address); }
  /** Forces how this address behaves as a recipient (MailboxStatus). */
  setStatus(status) { return this.client.setMailboxStatus(this.address, status); }
  /** Sends from this address: to, subject, text, html, cc, attachments, inReplyTo. */
  send(msg, opts) { return this.client.send({ ...msg, from: this.address }, opts); }
  /** Files a message straight into this mailbox, skipping SMTP. */
  inject(msg, opts) { return this.client.inject({ ...msg, to: this.address }, opts); }
  signature() { return this.client.signature(this.address); }
  setSignature(signature) { return this.client.setSignature(this.address, signature); }
  /** The persona behind this address, if any. */
  async getPersona() { return this.persona_id ? this.client.persona(this.persona_id) : null; }
}

/** A simulated person. */
export class Persona extends Resource {
  /** The address they write from. */
  get address() { return (this.raw.addresses || [])[0]; }
  get caseIds() { return this.case_ids || []; }
  get externalIds() { return this.external_ids || {}; }

  refresh() { return this.client.persona(this.id); }
  /** Changes only what you send (a nested object you send replaces that whole object). */
  update(changes) { return this.client.updatePersona(this.id, changes); }
  delete() { return this.client.deletePersona(this.id); }
  pause() { return this.update({ paused: true }); }
  resume() { return this.update({ paused: false }); }
  /** Their mailbox. */
  mailbox() { return this.client.mailbox(this.address); }
  /** The next email this person sends (fast: write their due reply now). */
  waitForReply(opts = {}) { return this.client.waitForReply({ ...opts, from: this.address }); }
  /** What they remember, by case id. */
  memory() { return this.client.memory(this.id); }
  /** Tells them something. */
  remember(text, { caseId, source } = {}) { return this.client.addMemory(this.id, { text, caseId, source }); }
  forgetMemory({ caseId } = {}) { return this.client.clearMemory(this.id, { caseId }); }
  relations() { return this.client.relations(this.id); }
  /** Forgets one correspondent, or everyone. */
  forget(address) { return this.client.forgetRelations(this.id, { address }); }
  /** Their planned work (state, kind, dueBefore, limit). */
  async jobs(opts = {}) {
    const r = await this.client.jobs({ ...opts, persona: this.id });
    return r.jobs.filter(j => j.persona_id === undefined || j.persona_id === this.id);
  }
  /** Runs their pending jobs now (kind, before, limit): {ran, count, remaining}. */
  runDue(opts = {}) { return this.client.runDue({ ...opts, persona: this.id }); }
  /**
   * Waits until they do something: an EventType or EventAlias such as
   * "replied", "declined", "clicked" or "bounced" (or a list). opts: messageId,
   * after, fast, timeout. Answers the SimEvent.
   */
  waitFor(type, opts = {}) { return this.client.waitForEvent({ ...opts, type, persona: this.id }); }
}

/** A matter your system pushed: the people in it and what is really true. */
export class Case extends Resource {
  get people() { return this.raw.people || []; }
  get storyBy() { return this.story_by || this.story_written_by; }
  refresh({ redact } = {}) { return this.client.getCase(this.id, { redact }); }
  /** Pushes more of what your system knows; it merges. */
  push(update) { return this.client.pushCase(this.id, update); }
  addPeople(people) { return this.client.addCasePeople(this.id, people); }
  /** Has a person start a new thread: persona (id or address), to, intent, after. */
  initiate(opts) { return this.client.initiateCase(this.id, opts); }
  regenerate() { return this.client.regenerateCase(this.id); }
  editStory(edit) { return this.client.editCaseStory(this.id, edit); }
  delete() { return this.client.deleteCase(this.id); }
}

/** Something planned for later: a reply, a follow-up, a nudge. */
export class Job extends Resource {
  get personaId() { return this.persona_id; }
  get caseId() { return this.case_id; }
  get isPending() { return this.state === "pending"; }
  run() { return this.client.runJob(this.id); }
  skip() { return this.client.skipJob(this.id); }
  /** Turns a planned reply into a bounce, now. */
  bounce() { return this.client.bounceJob(this.id); }
  /** due (a time) or in (such as "10m" from now). */
  reschedule(when) { return this.client.rescheduleJob(this.id, when); }
}

/** A login your app sends and reads with. */
export class Account extends Resource {
  get displayName() { return this.display_name; }
  get allowSmtp() { return this.allow_smtp; }
  get allowImap() { return this.allow_imap; }
  update(changes) { return this.client.updateAccount(this.address, changes); }
  delete() { return this.client.deleteAccount(this.address); }
  test(opts) { return this.client.testAccount(this.address, opts); }
  mailbox() { return this.client.mailbox(this.address); }
}

/** Something that happened: {id, at, kind, data}. kind is an EventType. */
export class SimEvent extends Resource {
  get personaId() { return (this.raw.data || {}).persona_id; }
  get messageId() { return (this.raw.data || {}).message_id; }
  get caseId() { return (this.raw.data || {}).case_id; }
  /** The persona it is about, when it is about one. */
  persona() { return this.personaId ? this.client.persona(this.personaId) : Promise.resolve(null); }
}

/** A conversation: its messages, oldest first. From waitForThread. */
export class Conversation extends Resource {
  constructor(client, data) {
    super(client, data);
    this.messages = (data.messages || []).map(m => new Message(client, m));
  }
  /** The id of its first message. */
  get root() { return this.thread; }
  /** Its newest message. */
  get latest() { return this.messages[this.messages.length - 1]; }
  get quietMs() { return this.quiet_ms; }
  get waitedMs() { return this.waited_ms; }
  /** Waits again, until nothing new has joined it for opts.quiet. */
  waitUntilQuiet(opts = {}) { return this.client.waitForThread({ ...opts, thread: this.thread }); }
  /** Answers its newest message (Message.reply options). */
  reply(opts) { return this.latest.reply(opts); }
}

/** A fresh address made for one test, from testAddress(). */
export class TestAddress extends Mailbox {
  /** Passes when nothing reaches it for opts.within (default "5s"); same filters as waitForEmail. */
  expectNoEmail(opts = {}) { return this.client.expectNoEmail({ ...opts, to: this.address }); }
  /** Deletes its mail (every folder, or opts.folder). */
  cleanup({ folder } = {}) { return this.client.deleteMessages({ to: this.address, folder }); }
  toString() { return this.address; }
}

/** Every address made with one tag. From mail.tag(name). */
export class TagGroup {
  constructor(client, tag) { Object.defineProperty(this, "client", { value: client }); this.tag = tag; }
  /** Another address with this tag (domain, prefix). */
  newAddress(opts = {}) { return this.client.testAddress({ ...opts, tag: this.tag }); }
  /** The next email to any of its addresses (waitForEmail options, such as count). */
  waitForEmail(opts = {}) { return this.client.waitForEmail({ ...opts, tag: this.tag }); }
  expectNoEmail(opts = {}) { return this.client.expectNoEmail({ ...opts, tag: this.tag }); }
  /** Their messages, newest first (folder, limit). */
  messages(opts = {}) { return this.client.listMessages({ ...opts, tag: this.tag }); }
  /** Deletes their mail (every folder, or opts.folder). */
  cleanup({ folder } = {}) { return this.client.deleteMessages({ tag: this.tag, folder }); }
}
