/* Attention Inbox PRD — interactions */

const STATE_COPY = {
  captured: {
    title: "CAPTURED",
    body: "事项已成功保存。这是 Capture 动作完成后的初始落库状态，用户可以立刻释放当前注意力。",
  },
  waiting: {
    title: "WAITING",
    body: "尚未到达重新唤醒时间。默认不出现在首页，也不制造任何视觉负担。",
  },
  delivered: {
    title: "DELIVERED",
    body: "系统已经发送提醒。注意：DELIVERED 不代表用户看到，更不能自动视为已确认。",
  },
  opened: {
    title: "OPENED",
    body: "用户点击了通知或打开了事项。该状态只作为行为记录，不得自动转换为 ACKNOWLEDGED。",
  },
  acknowledged: {
    title: "ACKNOWLEDGED",
    body: "用户明确点击「我知道了」。系统确认一次 Attention Delivery 成功；事项保持「已看到但未完成」。",
  },
  snoozed: {
    title: "SNOOZED",
    body: "用户明确要求稍后再提醒。系统重新建立下一次 WAITING，而不是结束追踪。",
  },
  active: {
    title: "ACTIVE / 已看到未完成",
    body: "ACK 之后仍未完成的活跃事项。它们出现在弱化的「已看到未完成 · N」入口中，不占据首页主视觉。",
  },
  completed: {
    title: "COMPLETED",
    body: "用户明确点击「完成」。这是唯一进入归档的正常出口。",
  },
  archived: {
    title: "ARCHIVED",
    body: "完成事项自动进入历史归档。历史默认不主动重新浮现。",
  },
};

function initLifecycle() {
  const root = document.getElementById("lifecycle");
  if (!root) return;

  const nodes = root.querySelectorAll(".lc-node");
  const detail = document.getElementById("lifecycleDetail");

  function select(node) {
    nodes.forEach((n) => n.classList.remove("is-active"));
    node.classList.add("is-active");
    const key = node.getAttribute("data-state");
    const copy = STATE_COPY[key];
    if (!copy || !detail) return;
    detail.innerHTML = `
      <p class="label">状态定义</p>
      <h4>${copy.title}</h4>
      <p>${copy.body}</p>
    `;
  }

  nodes.forEach((node) => {
    node.addEventListener("click", () => select(node));
    node.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        select(node);
      }
    });
  });

  const first = root.querySelector('.lc-node[data-state="acknowledged"]');
  if (first) select(first);
}

function initProgress() {
  const bar = document.getElementById("progress");
  if (!bar) return;

  const update = () => {
    const doc = document.documentElement;
    const scrollTop = doc.scrollTop || document.body.scrollTop;
    const height = doc.scrollHeight - doc.clientHeight;
    const ratio = height > 0 ? scrollTop / height : 0;
    bar.style.width = `${Math.min(100, Math.max(0, ratio * 100))}%`;
  };

  update();
  window.addEventListener("scroll", update, { passive: true });
  window.addEventListener("resize", update);
}

function initToc() {
  const toc = document.getElementById("toc");
  const toggle = document.getElementById("tocToggle");
  const backdrop = document.getElementById("tocBackdrop");
  const links = Array.from(document.querySelectorAll("#tocNav a"));
  const sections = links
    .map((a) => document.querySelector(a.getAttribute("href")))
    .filter(Boolean);

  if (toggle && toc && backdrop) {
    const close = () => {
      toc.classList.remove("open");
      backdrop.classList.remove("show");
      backdrop.hidden = true;
      toggle.setAttribute("aria-expanded", "false");
    };

    const open = () => {
      toc.classList.add("open");
      backdrop.classList.add("show");
      backdrop.hidden = false;
      toggle.setAttribute("aria-expanded", "true");
    };

    toggle.addEventListener("click", () => {
      if (toc.classList.contains("open")) close();
      else open();
    });

    backdrop.addEventListener("click", close);
    links.forEach((a) => a.addEventListener("click", close));
  }

  if (!("IntersectionObserver" in window) || sections.length === 0) return;

  const linkById = new Map(
    links.map((a) => [a.getAttribute("href").slice(1), a])
  );

  let activeId = null;

  const observer = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((e) => e.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio);

      if (visible.length === 0) return;
      const id = visible[0].target.id;
      if (id === activeId) return;
      activeId = id;
      links.forEach((a) => a.classList.remove("active"));
      const link = linkById.get(id);
      if (link) link.classList.add("active");
    },
    {
      rootMargin: "-20% 0px -55% 0px",
      threshold: [0.1, 0.25, 0.5],
    }
  );

  sections.forEach((section) => observer.observe(section));
}

document.addEventListener("DOMContentLoaded", () => {
  initLifecycle();
  initProgress();
  initToc();
});
