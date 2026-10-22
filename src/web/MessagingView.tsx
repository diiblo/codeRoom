import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  ApiClient,
  ApiClientError,
  clientId,
  type ActorType,
  type Agent,
  type Assignment,
  type Conversation,
  type Message,
} from "./api";

type ConnectionState =
  "connecting" | "live" | "reconnecting" | "requires-agent" | "offline";

type MessagingViewProps = {
  api: ApiClient;
  projectId: string;
  actorId: string;
  actorType: ActorType;
  assignmentId?: string;
  agents: Agent[];
  assignments: Assignment[];
};

function formatMessageDate(value: string) {
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function mergeMessages(current: Message[], incoming: Message[]) {
  const messages = new Map(current.map((message) => [message.id, message]));
  incoming.forEach((message) => messages.set(message.id, message));
  return [...messages.values()].sort((left, right) => {
    const dateOrder = left.createdAt.localeCompare(right.createdAt);
    return dateOrder || left.id.localeCompare(right.id);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function eventConversationId(value: unknown) {
  if (!isRecord(value) || !isRecord(value.payload)) return undefined;
  return typeof value.payload.conversationId === "string"
    ? value.payload.conversationId
    : undefined;
}

function connectionLabel(state: ConnectionState) {
  switch (state) {
    case "live":
      return "Temps réel actif";
    case "connecting":
      return "Connexion…";
    case "reconnecting":
      return "Reconnexion…";
    case "requires-agent":
      return "Identité agent requise";
    case "offline":
      return "Flux interrompu";
  }
}

function connectionTone(state: ConnectionState) {
  if (state === "live") return "good" as const;
  if (state === "requires-agent" || state === "offline") return "warn" as const;
  return "muted" as const;
}

function StatusBadge({
  children,
  tone,
}: {
  children: string;
  tone: "accent" | "good" | "warn" | "muted";
}) {
  return <span className={`status-badge status-badge-${tone}`}>{children}</span>;
}

function conversationLabel(conversation: Conversation) {
  if (conversation.kind === "main") return "Groupe principal";
  if (conversation.kind === "ticket") return "Discussion du ticket";
  return "Conversation directe";
}

function mentionReasonLabel(reason: string | null) {
  switch (reason) {
    case "agent_auto_mention_disabled":
      return "une sortie d’agent ne peut pas relancer un autre agent";
    case "provider_unavailable":
      return "le fournisseur est indisponible";
    case "assignment_inactive":
      return "l’affectation est inactive";
    case "conversation_membership_required":
      return "la cible ne participe pas à ce fil";
    default:
      return "la politique serveur l’a refusée";
  }
}

function MessageBubble({
  message,
  agents,
  actorId,
}: {
  message: Message;
  agents: Agent[];
  actorId: string;
}) {
  const author = agents.find((agent) => agent.id === message.authorId);
  const authorName =
    author?.displayName ??
    (message.authorType === "human"
      ? "Superviseur"
      : message.authorType === "system"
        ? "Système"
        : message.authorId);
  const own = message.authorId === actorId;

  return (
    <article className={`message-bubble ${own ? "is-own" : ""}`}>
      <div className="message-bubble-heading">
        <strong>{authorName}</strong>
        <span>{message.authorType === "agent" ? "agent" : message.authorType}</span>
      </div>
      <p>{message.text}</p>
      <time dateTime={message.createdAt}>{formatMessageDate(message.createdAt)}</time>
    </article>
  );
}

export function MessagingView({
  api,
  projectId,
  actorId,
  actorType,
  assignmentId,
  agents,
  assignments,
}: MessagingViewProps) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(
    null,
  );
  const [messages, setMessages] = useState<Message[]>([]);
  const [messageCursor, setMessageCursor] = useState<string | undefined>();
  const [draft, setDraft] = useState("");
  const [conversationLoading, setConversationLoading] = useState(true);
  const [messageLoading, setMessageLoading] = useState(false);
  const [olderLoading, setOlderLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connection, setConnection] = useState<ConnectionState>(
    actorType === "agent" ? "connecting" : "requires-agent",
  );
  const selectedConversationRef = useRef<string | null>(null);
  const cursorRef = useRef<string | undefined>(undefined);
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closedRef = useRef(false);
  const messageRequestRef = useRef(0);

  const activeMentionAgents = assignments
    .filter((assignment) => assignment.status === "active")
    .map((assignment) => agents.find((agent) => agent.id === assignment.agentId))
    .filter((agent): agent is Agent => Boolean(agent && agent.archivedAt === null));

  const loadConversations = useCallback(async () => {
    if (actorType !== "agent") {
      setConversations([]);
      setConversationLoading(false);
      return;
    }
    setConversationLoading(true);
    try {
      const response = await api.listConversations(projectId);
      setConversations(response.items);
      setSelectedConversationId((current) =>
        current && response.items.some((conversation) => conversation.id === current)
          ? current
          : (response.items[0]?.id ?? null),
      );
    } catch (requestError: unknown) {
      setError(
        requestError instanceof ApiClientError
          ? requestError.message
          : "Les conversations n’ont pas pu être chargées.",
      );
    } finally {
      setConversationLoading(false);
    }
  }, [actorType, api, projectId]);

  const loadMessages = useCallback(
    async (
      conversationId: string,
      mode: "replace" | "prepend" | "merge",
      before?: string,
    ) => {
      if (actorType !== "agent") return;
      const requestId = ++messageRequestRef.current;
      if (mode === "replace") setMessageLoading(true);
      if (mode === "prepend") setOlderLoading(true);
      try {
        const response = await api.listMessages(conversationId, { before });
        if (requestId !== messageRequestRef.current) return;
        setMessages((current) =>
          mode === "replace" ? response.items : mergeMessages(current, response.items),
        );
        setMessageCursor(response.nextCursor);
        setError(null);
      } catch (requestError: unknown) {
        if (requestId !== messageRequestRef.current) return;
        setError(
          requestError instanceof ApiClientError
            ? requestError.message
            : "Les messages n’ont pas pu être chargés.",
        );
      } finally {
        if (requestId === messageRequestRef.current) {
          setMessageLoading(false);
          setOlderLoading(false);
        }
      }
    },
    [actorType, api],
  );

  useEffect(() => {
    selectedConversationRef.current = selectedConversationId;
  }, [selectedConversationId]);

  useEffect(() => {
    cursorRef.current = undefined;
    setError(null);
    void loadConversations();
  }, [loadConversations, projectId]);

  useEffect(() => {
    messageRequestRef.current += 1;
    setMessages([]);
    setMessageCursor(undefined);
    if (selectedConversationId && actorType === "agent") {
      void loadMessages(selectedConversationId, "replace");
    }
  }, [actorType, loadMessages, selectedConversationId]);

  useEffect(() => {
    closedRef.current = false;
    cursorRef.current = undefined;
    if (actorType !== "agent") {
      setConnection("requires-agent");
      return () => {
        closedRef.current = true;
      };
    }

    const scheduleReconnect = () => {
      if (closedRef.current || reconnectTimerRef.current) return;
      setConnection("reconnecting");
      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
        connect();
      }, 1500);
    };

    const connect = () => {
      if (closedRef.current) return;
      setConnection(cursorRef.current ? "reconnecting" : "connecting");
      let socket: WebSocket;
      try {
        socket = new WebSocket(api.eventsUrl(projectId, cursorRef.current));
      } catch {
        setConnection("offline");
        scheduleReconnect();
        return;
      }
      socketRef.current = socket;
      socket.onopen = () => setConnection("live");
      socket.onmessage = (event) => {
        try {
          const notification: unknown = JSON.parse(String(event.data));
          if (!isRecord(notification)) return;
          if (typeof notification.cursor === "string") {
            cursorRef.current = notification.cursor;
          }
          if (notification.type !== "message.posted") return;
          void loadConversations();
          const conversationId = eventConversationId(notification);
          if (conversationId && conversationId === selectedConversationRef.current) {
            void loadMessages(conversationId, "merge");
          }
        } catch {
          setError("Le flux temps réel a envoyé une notification illisible.");
        }
      };
      socket.onclose = () => {
        if (socketRef.current === socket) socketRef.current = null;
        scheduleReconnect();
      };
      socket.onerror = () => setConnection("offline");
    };

    connect();
    return () => {
      closedRef.current = true;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [actorType, api, loadConversations, loadMessages, projectId]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim();
    if (!selectedConversationId || actorType !== "agent") {
      setError("Sélectionnez une identité agent affectée pour envoyer un message.");
      return;
    }
    if (!text) return;
    setSending(true);
    try {
      const response = await api.sendMessage(selectedConversationId, {
        id: clientId("message"),
        text,
      });
      setMessages((current) => mergeMessages(current, [response.message]));
      setDraft("");
      setError(null);
      const rejectedMentions = response.routing.intentions.filter(
        (intention) => intention.status === "rejected",
      );
      if (rejectedMentions.length > 0) {
        const first = rejectedMentions[0];
        setError(
          `La mention @${first.targetAgentId} n’a pas été activée : ${mentionReasonLabel(first.reason)}.`,
        );
      }
    } catch (requestError: unknown) {
      setError(
        requestError instanceof ApiClientError
          ? requestError.message
          : "Le message n’a pas pu être envoyé.",
      );
    } finally {
      setSending(false);
    }
  }

  function addMention(agentId: string) {
    setDraft(
      (current) =>
        `${current}${current && !/\s$/.test(current) ? " " : ""}@${agentId} `,
    );
  }

  const selectedConversation = conversations.find(
    (conversation) => conversation.id === selectedConversationId,
  );
  const identityHint =
    actorType !== "agent"
      ? "La messagerie nécessite une identité agent."
      : !assignmentId
        ? "Renseignez l’affectation dans Paramètres locaux pour lire et envoyer."
        : "Les messages sont persistés par l’API ; le flux temps réel ne fait que notifier.";

  return (
    <section className="messaging-view" aria-labelledby="messaging-title">
      <div className="section-title-line">
        <div>
          <p className="eyebrow">Espace de discussion</p>
          <h2 id="messaging-title">Parler aux agents</h2>
          <p className="section-supporting-copy">
            Historique persistant, mentions ciblées et reprise après reconnexion.
          </p>
        </div>
        <div className="messaging-status">
          <StatusBadge tone={connectionTone(connection)}>
            {connectionLabel(connection)}
          </StatusBadge>
          <span>{identityHint}</span>
        </div>
      </div>

      {error && (
        <div className="message-notice" role="alert">
          {error}
        </div>
      )}

      <div className="message-console">
        <aside className="conversation-rail" aria-label="Conversations du projet">
          <div className="conversation-rail-heading">
            <div>
              <p className="eyebrow">Projet sélectionné</p>
              <h3>Conversations</h3>
            </div>
            <span>{conversations.length.toString().padStart(2, "0")}</span>
          </div>
          {conversationLoading ? (
            <p className="muted-copy">Lecture des conversations…</p>
          ) : actorType !== "agent" ? (
            <p className="muted-copy">
              Passez sur une identité agent pour ouvrir les fils.
            </p>
          ) : conversations.length === 0 ? (
            <p className="muted-copy">
              Aucune conversation accessible pour cette identité.
            </p>
          ) : (
            <nav className="conversation-list" aria-label="Fils accessibles">
              {conversations.map((conversation) => (
                <button
                  className={`conversation-list-item ${conversation.id === selectedConversationId ? "is-selected" : ""}`}
                  key={conversation.id}
                  type="button"
                  onClick={() => setSelectedConversationId(conversation.id)}
                >
                  <span className="conversation-symbol" aria-hidden="true">
                    {conversation.kind === "main"
                      ? "◎"
                      : conversation.kind === "ticket"
                        ? "◇"
                        : "·"}
                  </span>
                  <span>
                    <strong>{conversationLabel(conversation)}</strong>
                    <small>{conversation.id}</small>
                  </span>
                </button>
              ))}
            </nav>
          )}
        </aside>

        <section className="message-pane" aria-label="Fil de messages">
          <header className="message-pane-heading">
            <div>
              <p className="eyebrow">
                {selectedConversation
                  ? conversationLabel(selectedConversation)
                  : "Aucun fil"}
              </p>
              <h3>{selectedConversation?.id ?? "Sélectionnez une conversation"}</h3>
            </div>
            {selectedConversation && (
              <span className="message-pane-meta">Historique synchronisé</span>
            )}
          </header>

          <div
            className="message-stream"
            role="log"
            aria-live="polite"
            aria-busy={messageLoading}
          >
            {messageCursor && (
              <button
                className="text-button load-older-button"
                type="button"
                disabled={olderLoading}
                onClick={() => {
                  if (selectedConversationId && messageCursor) {
                    void loadMessages(selectedConversationId, "prepend", messageCursor);
                  }
                }}
              >
                {olderLoading ? "Chargement…" : "Charger les messages précédents"}
              </button>
            )}
            {messageLoading ? (
              <p className="muted-copy">Lecture de l’historique…</p>
            ) : !selectedConversation ? (
              <div className="message-empty">
                <span aria-hidden="true">/</span>
                <p>Choisissez un fil pour voir son historique.</p>
              </div>
            ) : messages.length === 0 ? (
              <div className="message-empty">
                <span aria-hidden="true">◎</span>
                <p>Aucun message dans cette conversation.</p>
              </div>
            ) : (
              messages.map((message) => (
                <MessageBubble
                  key={message.id}
                  message={message}
                  agents={agents}
                  actorId={actorId}
                />
              ))
            )}
          </div>

          <form className="message-composer" onSubmit={handleSubmit}>
            <label htmlFor="message-draft">Nouveau message</label>
            <textarea
              id="message-draft"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Écrivez un message…"
              rows={3}
              disabled={!selectedConversationId || actorType !== "agent" || sending}
            />
            <div className="mention-tools">
              <span>Mentionner</span>
              <button
                type="button"
                onClick={() => addMention("tous")}
                disabled={!selectedConversationId}
              >
                @tous
              </button>
              {activeMentionAgents.map((agent) => (
                <button
                  key={agent.id}
                  type="button"
                  onClick={() => addMention(agent.id)}
                  disabled={!selectedConversationId}
                >
                  @{agent.id}
                </button>
              ))}
            </div>
            <div className="composer-footer">
              <span>
                Une mention ciblée peut créer une exécution ; @tous notifie seulement.
              </span>
              <button
                className="primary-button"
                type="submit"
                disabled={
                  !selectedConversationId ||
                  actorType !== "agent" ||
                  !draft.trim() ||
                  sending
                }
              >
                {sending ? "Envoi…" : "Envoyer"}
              </button>
            </div>
          </form>
        </section>
      </div>
    </section>
  );
}
