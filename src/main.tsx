import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  BookOpen,
  Search,
  Bookmark,
  Download,
  LogIn,
  LogOut,
  Plus,
  Trash2,
  X,
  ChevronLeft,
  ChevronRight,
  Users,
} from "lucide-react";
import { jsPDF } from "jspdf";
import type { BookDto, ChapterDto, SeriesDto, UserDto } from "../shared/types";
import "./style.css";
type Me = UserDto | null;
type View = "library" | "bookmarks" | "progress" | "admin";
async function api<T = any>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, {
      credentials: "include",
      headers: {
        ...(init?.body instanceof FormData
          ? {}
          : { "Content-Type": "application/json" }),
      },
      ...init,
    }),
    b = await r.json().catch(() => ({}));
  if (!r.ok) throw Error(b.error?.message || "Anfrage fehlgeschlagen");
  return b;
}
function App() {
  const [series, setSeries] = useState<SeriesDto[]>([]),
    [me, setMe] = useState<Me>(null),
    [view, setView] = useState<View>("library"),
    [query, setQuery] = useState(""),
    [selected, setSelected] = useState<BookDto | null>(null),
    [reader, setReader] = useState<{ book: BookDto; index: number } | null>(
      null,
    ),
    [login, setLogin] = useState(false),
    [toast, setToast] = useState("");
  const note = (s: string) => {
      setToast(s);
      setTimeout(() => setToast(""), 2500);
    },
    load = async () => {
      const l = await api<{ series: SeriesDto[] }>(
        "/api/library" + (query ? "?q=" + encodeURIComponent(query) : ""),
      );
      const a = await api<{ user: UserDto }>("/api/auth/me").catch(() => null);
      setMe(a?.user || null);
      if (a?.user) {
        const marks = await api<{ books: BookDto[] }>("/api/me/bookmarks");
        const ids = new Set(marks.books.map((b) => b.id));
        l.series.forEach((s) =>
          s.books.forEach((b) => (b.bookmarked = ids.has(b.id))),
        );
      }
      setSeries(l.series);
    };
  useEffect(() => {
    load();
  }, []);
  useEffect(() => {
    const t = setTimeout(
      () =>
        api<{ series: SeriesDto[] }>(
          "/api/library" + (query ? "?q=" + encodeURIComponent(query) : ""),
        ).then((x) => setSeries(x.series)),
      250,
    );
    return () => clearTimeout(t);
  }, [query]);
  const books = series.flatMap((s) => s.books);
  async function open(b: BookDto) {
    setSelected(
      (await api<{ book: BookDto }>("/api/library/books/" + b.id)).book,
    );
  }
  async function read(b: BookDto, i = 0) {
    const full = b.chapters
      ? b
      : (await api<{ book: BookDto }>("/api/library/books/" + b.id)).book;
    if (!full.chapters?.length)
      return note("Noch keine Kapitel veröffentlicht.");
    setSelected(null);
    setReader({ book: full, index: i });
    if (me)
      api("/api/me/progress/" + full.id, {
        method: "PUT",
        body: JSON.stringify({ chapterId: full.chapters[i].id }),
      });
  }
  async function logout() {
    try {
      await api("/api/auth/logout", { method: "POST" });
    } catch {
      note("Die Sitzung wurde lokal beendet.");
    } finally {
      setMe(null);
      setView("library");
      setSelected(null);
      setReader(null);
      setSeries((items) =>
        items.map((s) => ({
          ...s,
          books: s.books.map((b) => ({ ...b, bookmarked: false })),
        })),
      );
    }
  }
  return (
    <>
      <header>
        <button className="brand" onClick={() => setView("library")}>
          <BookOpen size={34} />
          <span>
            Meine<span>Geschichtenbibliothek.</span>
          </span>
        </button>
        <nav>
          <button onClick={() => setView("library")}>Bibliothek</button>
          {me && (
            <>
              <button onClick={() => setView("bookmarks")}>Lesezeichen</button>
              <button onClick={() => setView("progress")}>
                Lesefortschritt
              </button>
            </>
          )}
          {me?.role === "ADMIN" && (
            <button onClick={() => setView("admin")}>Verwaltung</button>
          )}
        </nav>
        <div className="header-actions">
          {me ? (
            <>
              <b>{me.name}</b>
              <button
                type="button"
                aria-label="Abmelden"
                title="Abmelden"
                onClick={logout}
              >
                <LogOut />
              </button>
            </>
          ) : (
            <button className="login-button" onClick={() => setLogin(true)}>
              <LogIn /> Anmelden
            </button>
          )}
        </div>
      </header>
      {view === "library" && (
        <>
          <section className="hero">
            <div className="hero-bg" />
            <div className="hero-inner">
              <div className="eyebrow">EIN ORT FÜR GESCHICHTEN</div>
              <h1>
                Kleine Geschichten.
                <br />
                <em>Große Welten.</em>
              </h1>
              <p>Entdecke Bücher und lies ihre Kapitel direkt online.</p>
            </div>
          </section>
          <main>
            <div className="section-heading">
              <div>
                <div className="eyebrow">DEIN NÄCHSTES ABENTEUER</div>
                <h2>Unsere Bücher</h2>
              </div>
              <label className="inline-search">
                <Search />
                <input
                  type="search"
                  aria-label="Bücher durchsuchen"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Suchen …"
                />
              </label>
            </div>
            {books.length ? (
              <div className="book-grid">
                {books.map((b) => (
                  <Card
                    key={b.id}
                    b={b}
                    open={() => open(b)}
                    mark={async () => {
                      if (!me) return setLogin(true);
                      await api("/api/me/bookmarks/" + b.id, {
                        method: b.bookmarked ? "DELETE" : "PUT",
                      });
                      setSeries((xs) =>
                        xs.map((s) => ({
                          ...s,
                          books: s.books.map((x) =>
                            x.id === b.id
                              ? { ...x, bookmarked: !b.bookmarked }
                              : x,
                          ),
                        })),
                      );
                      note("Lesezeichen aktualisiert");
                    }}
                  />
                ))}
              </div>
            ) : (
              <Empty text="Die Bibliothek ist noch leer." />
            )}
          </main>
        </>
      )}
      {view === "bookmarks" && <Personal kind="bookmarks" read={read} />}{" "}
      {view === "progress" && <Personal kind="progress" read={read} />}{" "}
      {view === "admin" && me?.role === "ADMIN" && <Admin note={note} />}{" "}
      {selected && (
        <div className="modal-backdrop" onClick={() => setSelected(null)}>
          <section
            className="detail-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <button className="close" onClick={() => setSelected(null)}>
              <X />
            </button>
            {selected.coverUrl ? (
              <img className="detail-cover" src={selected.coverUrl} />
            ) : (
              <BookOpen size={60} />
            )}
            <h2>{selected.title}</h2>
            <p>{selected.description}</p>
            {selected.chapters?.map((c, i) => (
              <div className="volume" key={c.id}>
                <b>{i + 1}</b>
                <h3>{c.title}</h3>
                <button
                  className="gold-button"
                  onClick={() => read(selected, i)}
                >
                  Lesen
                </button>
              </div>
            ))}
            <button className="outline-button" onClick={() => pdf(selected)}>
              <Download /> PDF
            </button>
          </section>
        </div>
      )}
      {reader && (
        <Reader
          value={reader}
          me={me}
          close={() => setReader(null)}
          change={(i) => {
            setReader({ ...reader, index: i });
            if (me)
              api("/api/me/progress/" + reader.book.id, {
                method: "PUT",
                body: JSON.stringify({
                  chapterId: reader.book.chapters![i].id,
                }),
              });
          }}
        />
      )}
      {login && (
        <Login
          close={() => setLogin(false)}
          done={(u) => {
            setMe(u);
            setLogin(false);
            load();
          }}
        />
      )}
      {toast && <div className="toast">{toast}</div>}
    </>
  );
}
function Card({
  b,
  open,
  mark,
}: {
  b: BookDto;
  open: () => void;
  mark: () => void;
}) {
  return (
    <article className="book-card">
      <button className="book-cover green" onClick={open}>
        {b.coverUrl ? (
          <img src={b.coverUrl} />
        ) : (
          <div className="cover-frame">
            <small>DIE GESCHICHTENBIBLIOTHEK</small>
            <h3>{b.title}</h3>
            <BookOpen className="cover-symbol" />
            <b>BAND {b.volumeNumber}</b>
          </div>
        )}
      </button>
      <div className="book-info">
        <div className="book-title-row">
          <button onClick={open}>
            <h3>{b.title}</h3>
          </button>
          <button onClick={mark}>
            <Bookmark />
          </button>
        </div>
        <p>{b.description}</p>
        <button className="book-link" onClick={open}>
          Buch entdecken
        </button>
      </div>
    </article>
  );
}
function Empty({ text }: { text: string }) {
  return (
    <div className="empty">
      <BookOpen />
      <h3>{text}</h3>
    </div>
  );
}
function Login({
  close,
  done,
}: {
  close: () => void;
  done: (u: UserDto) => void;
}) {
  const [err, setErr] = useState("");
  return (
    <div className="modal-backdrop">
      <form
        className="detail-modal login-modal"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          try {
            done(
              (
                await api<{ user: UserDto }>("/api/auth/login", {
                  method: "POST",
                  body: JSON.stringify({
                    username: f.get("username"),
                    password: f.get("password"),
                  }),
                })
              ).user,
            );
          } catch (x) {
            setErr((x as Error).message);
          }
        }}
      >
        <button type="button" className="close" onClick={close}>
          <X />
        </button>
        <h2>Anmelden</h2>
        <label>
          Benutzername
          <input name="username" autoComplete="username" required />
        </label>
        <label>
          Passwort
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </label>
        {err && <p className="form-error">{err}</p>}
        <button className="gold-button">Anmelden</button>
      </form>
    </div>
  );
}
function Reader({
  value,
  me,
  close,
  change,
}: {
  value: { book: BookDto; index: number };
  me: Me;
  close: () => void;
  change: (i: number) => void;
}) {
  const cs = value.book.chapters!,
    c = cs[value.index];
  return (
    <div className="reader">
      <div className="reader-toolbar">
        <button onClick={close}>
          <ChevronLeft /> Bibliothek
        </button>
        <span>{value.book.title}</span>
        <button onClick={close}>
          <X />
        </button>
      </div>
      <article className="reader-page">
        <div className="eyebrow">
          KAPITEL {value.index + 1} VON {cs.length}
        </div>
        <h1>{c.title}</h1>
        <div
          className="chapter-content"
          dangerouslySetInnerHTML={{ __html: c.content }}
        />
        <div className="reader-page-foot">
          <button
            disabled={!value.index}
            onClick={() => change(value.index - 1)}
          >
            <ChevronLeft /> Zurück
          </button>
          <button
            disabled={value.index === cs.length - 1}
            onClick={() => change(value.index + 1)}
          >
            Weiter <ChevronRight />
          </button>
        </div>
        {!me && <p>Melde dich an, um den Lesestand zu speichern.</p>}
      </article>
    </div>
  );
}
async function pdf(b: BookDto) {
  const d = new jsPDF();
  d.text(b.title, 20, 25);
  b.chapters?.forEach((c, i) => {
    d.addPage();
    d.text(`${i + 1}. ${c.title}`, 20, 25);
    const text =
      new DOMParser().parseFromString(c.content, "text/html").body
        .textContent || "";
    d.text(d.splitTextToSize(text, 170), 20, 40);
  });
  d.save(b.title + ".pdf");
}
function Personal({
  kind,
  read,
}: {
  kind: "bookmarks" | "progress";
  read: (b: BookDto) => void;
}) {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    api<any>("/api/me/" + kind).then((x) =>
      setRows(kind === "bookmarks" ? x.books : x.progress),
    );
  }, []);
  return (
    <main>
      <div className="section-heading">
        <h2>
          {kind === "bookmarks" ? "Meine Lesezeichen" : "Lesefortschritt"}
        </h2>
      </div>
      {rows.map((r: any) => {
        const b = kind === "bookmarks" ? r : r.book;
        return (
          <div className="list-row" key={b.id}>
            <BookOpen />
            <div>
              <h3>{b.title}</h3>
              <p>{kind === "progress" ? r.chapter.title : b.description}</p>
            </div>
            <button onClick={() => read(b)}>Lesen</button>
          </div>
        );
      })}
    </main>
  );
}
function Admin({ note }: { note: (s: string) => void }) {
  const [data, setData] = useState<SeriesDto[]>([]),
    [users, setUsers] = useState<UserDto[]>([]),
    [tab, setTab] = useState<"content" | "users">("content"),
    [bookFor, setBookFor] = useState(""),
    [chapterFor, setChapterFor] = useState("");
  const refresh = () =>
    Promise.all([
      api<{ series: SeriesDto[] }>("/api/admin/series").then((x) =>
        setData(x.series),
      ),
      api<{ users: UserDto[] }>("/api/admin/users").then((x) =>
        setUsers(x.users),
      ),
    ]);
  useEffect(() => {
    refresh();
  }, []);
  return (
    <main>
      <div className="section-heading">
        <h2>Bibliothek verwalten</h2>
        <div className="admin-tabs">
          <button onClick={() => setTab("content")}>Inhalte</button>
          <button onClick={() => setTab("users")}>
            <Users /> Benutzer
          </button>
        </div>
      </div>
      {tab === "content" ? (
        <>
          <SeriesForm saved={refresh} />
          {data.map((s) => (
            <section className="admin-series" key={s.id}>
              <div className="admin-heading">
                <div>
                  <span className={"status " + s.status.toLowerCase()}>
                    {s.status === "PUBLISHED" ? "Veröffentlicht" : "Entwurf"}
                  </span>
                  <h2>{s.title}</h2>
                </div>
                <button onClick={() => setBookFor(s.id)}>
                  <Plus /> Buch
                </button>
                <Del
                  label="Reihe"
                  run={async () => {
                    await api("/api/admin/series/" + s.id, {
                      method: "DELETE",
                    });
                    refresh();
                  }}
                />
              </div>
              {bookFor === s.id && (
                <BookForm
                  id={s.id}
                  saved={() => {
                    setBookFor("");
                    refresh();
                  }}
                />
              )}
              {s.books.map((b) => (
                <div className="admin-book" key={b.id}>
                  <div className="book-summary">
                    {b.coverUrl ? <img src={b.coverUrl} /> : <BookOpen />}
                    <div>
                      <h3>
                        Band {b.volumeNumber}: {b.title}
                      </h3>
                      <p>
                        {b.status} · {b.chapters?.length || 0} Kapitel
                      </p>
                    </div>
                    <label className="cover-upload">
                      Cover
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        onChange={async (e) => {
                          if (e.target.files?.[0]) {
                            const f = new FormData();
                            f.append("file", e.target.files[0]);
                            await api("/api/admin/books/" + b.id + "/cover", {
                              method: "POST",
                              body: f,
                            });
                            refresh();
                          }
                        }}
                      />
                    </label>
                    <button onClick={() => setChapterFor(b.id)}>
                      <Plus /> Kapitel
                    </button>
                    <Del
                      label="Buch"
                      run={async () => {
                        await api("/api/admin/books/" + b.id, {
                          method: "DELETE",
                        });
                        refresh();
                      }}
                    />
                  </div>
                  {chapterFor === b.id && (
                    <ChapterForm
                      id={b.id}
                      next={(b.chapters?.length || 0) + 1}
                      saved={() => {
                        setChapterFor("");
                        refresh();
                      }}
                    />
                  )}
                  {b.chapters?.map((c) => (
                    <div className="chapter-row" key={c.id}>
                      <b>{c.sortOrder}</b>
                      <span>
                        {c.title} · {c.status}
                      </span>
                      <Del
                        label="Kapitel"
                        run={async () => {
                          await api("/api/admin/chapters/" + c.id, {
                            method: "DELETE",
                          });
                          refresh();
                        }}
                      />
                    </div>
                  ))}
                </div>
              ))}
            </section>
          ))}
        </>
      ) : (
        <>
          <UserForm saved={refresh} />
          {users.map((u) => (
            <div className="list-row" key={u.id}>
              <Users />
              <div>
                <h3>{u.name}</h3>
                <p>
                    @{u.username} · {u.role} · {u.active ? "Aktiv" : "Inaktiv"}
                </p>
              </div>
              <button
                onClick={async () => {
                  await api("/api/admin/users/" + u.id, {
                    method: "PUT",
                    body: JSON.stringify({ active: !u.active }),
                  });
                  refresh();
                }}
              >
                {u.active ? "Deaktivieren" : "Aktivieren"}
              </button>
            </div>
          ))}
        </>
      )}
    </main>
  );
}
const get = (f: FormData, n: string) => f.get(n);
function SeriesForm({ saved }: { saved: () => any }) {
  return (
    <form
      className="admin-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        await api("/api/admin/series", {
          method: "POST",
          body: JSON.stringify({
            title: get(f, "title"),
            genre: get(f, "genre"),
            description: get(f, "description"),
            status: get(f, "status"),
            sortOrder: 0,
          }),
        });
        e.currentTarget.reset();
        saved();
      }}
    >
      <h3>Neue Buchreihe</h3>
      <div className="form-grid">
        <label>
          Titel
          <input name="title" required />
        </label>
        <label>
          Genre
          <input name="genre" required />
        </label>
        <label>
          Status
          <select name="status">
            <option value="DRAFT">Entwurf</option>
            <option value="PUBLISHED">Veröffentlicht</option>
          </select>
        </label>
      </div>
      <label>
        Beschreibung
        <textarea name="description" required />
      </label>
      <button className="gold-button">Reihe anlegen</button>
    </form>
  );
}
function BookForm({ id, saved }: { id: string; saved: () => void }) {
  return (
    <form
      className="nested-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        await api("/api/admin/books", {
          method: "POST",
          body: JSON.stringify({
            seriesId: id,
            title: get(f, "title"),
            subtitle: get(f, "subtitle") || null,
            description: get(f, "description"),
            volumeNumber: Number(get(f, "volume")),
            sortOrder: 0,
            status: get(f, "status"),
          }),
        });
        saved();
      }}
    >
      <h3>Neues Buch</h3>
      <div className="form-grid">
        <label>
          Titel
          <input name="title" required />
        </label>
        <label>
          Untertitel
          <input name="subtitle" />
        </label>
        <label>
          Band
          <input name="volume" type="number" min="1" required />
        </label>
        <label>
          Status
          <select name="status">
            <option value="DRAFT">Entwurf</option>
            <option value="PUBLISHED">Veröffentlicht</option>
          </select>
        </label>
      </div>
      <label>
        Beschreibung
        <textarea name="description" required />
      </label>
      <button>Buch anlegen</button>
    </form>
  );
}
function ChapterForm({
  id,
  next,
  saved,
}: {
  id: string;
  next: number;
  saved: () => void;
}) {
  const editor = useRef<HTMLDivElement>(null);
  return (
    <form
      className="nested-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        await api("/api/admin/chapters", {
          method: "POST",
          body: JSON.stringify({
            bookId: id,
            title: get(f, "title"),
            sortOrder: Number(get(f, "order")),
            status: get(f, "status"),
            content: editor.current?.innerHTML || "",
          }),
        });
        saved();
      }}
    >
      <h3>Neues Kapitel</h3>
      <div className="form-grid">
        <label>
          Titel
          <input name="title" required />
        </label>
        <label>
          Nummer
          <input name="order" type="number" min="1" defaultValue={next} />
        </label>
        <label>
          Status
          <select name="status">
            <option value="DRAFT">Entwurf</option>
            <option value="PUBLISHED">Veröffentlicht</option>
          </select>
        </label>
      </div>
      <div className="editor-toolbar">
        <button type="button" onClick={() => document.execCommand("bold")}>
          Fett
        </button>
        <button type="button" onClick={() => document.execCommand("italic")}>
          Kursiv
        </button>
        <button
          type="button"
          onClick={() => document.execCommand("insertUnorderedList")}
        >
          Liste
        </button>
      </div>
      <div className="rich-editor" contentEditable ref={editor} />
      <button>Kapitel anlegen</button>
    </form>
  );
}
function UserForm({ saved }: { saved: () => any }) {
  return (
    <form
      className="admin-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        await api("/api/admin/users", {
          method: "POST",
          body: JSON.stringify({
            name: get(f, "name"),
            username: get(f, "username"),
            password: get(f, "password"),
            role: get(f, "role"),
            active: true,
          }),
        });
        e.currentTarget.reset();
        saved();
      }}
    >
      <h3>Neues Benutzerkonto</h3>
      <div className="form-grid">
        <label>
          Anzeigename
          <input name="name" required />
        </label>
        <label>
          Benutzername
          <input
            name="username"
            minLength={3}
            pattern="[a-zA-Z0-9._-]+"
            required
          />
        </label>
        <label>
          Passwort
          <input name="password" type="password" minLength={10} required />
        </label>
        <label>
          Rolle
          <select name="role">
            <option value="READER">Leser</option>
            <option value="ADMIN">Administrator</option>
          </select>
        </label>
      </div>
      <button>Konto anlegen</button>
    </form>
  );
}
function Del({ label, run }: { label: string; run: () => Promise<void> }) {
  return (
    <button
      className="danger-button"
      aria-label={label + " löschen"}
      onClick={() => confirm(label + " wirklich löschen?") && run()}
    >
      <Trash2 />
    </button>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
