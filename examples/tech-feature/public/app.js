// Framework-free front end: list, add, “done” checkbox. Without sign-in, falls back to demo user 1.
const headers = { 'content-type': 'application/json', 'x-user-id': localStorage.getItem('userId') ?? '1' };
const list = document.querySelector('#tasks');
const today = new Date().toISOString().slice(0, 10);

async function api(method, url, body) {
  const res = await fetch(url, { method, headers, body: body && JSON.stringify(body) });
  if (!res.ok) throw new Error(`${method} ${url}: ${res.status}`);
  return res.status === 204 ? null : res.json();
}

function render(tasks) {
  list.replaceChildren(...tasks.map((task) => {
    const li = document.createElement('li');
    li.classList.toggle('done', !!task.done);
    li.classList.toggle('late', !task.done && !!task.dueDate && task.dueDate < today);
    const box = Object.assign(document.createElement('input'), { type: 'checkbox', checked: !!task.done });
    box.addEventListener('change', () => api('PATCH', `/api/tasks/${task.id}`, { done: box.checked }).then(load));
    const due = task.dueDate ? Object.assign(document.createElement('time'), { textContent: task.dueDate }) : '';
    li.append(box, ` ${task.title}`, due);
    return li;
  }));
}

async function load() {
  render(await api('GET', '/api/tasks'));
}

document.querySelector('#new-task').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.target);
  await api('POST', '/api/tasks', { title: form.get('title'), dueDate: form.get('dueDate') || null });
  event.target.reset();
  load();
});

api('GET', '/api/me').then((me) => { document.querySelector('#user-name').textContent = me.name; });
load();
