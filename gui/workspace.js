const navItems=[...document.querySelectorAll('.nav-item')];
const canvas=document.getElementById('workspaceCanvas');
const pageViews=[...document.querySelectorAll('.page-view')];

function activate(page){
  navItems.forEach(button=>{
    const active=button.dataset.page===page;
    button.classList.toggle('is-active',active);
    if(active) button.setAttribute('aria-current','page');
    else button.removeAttribute('aria-current');
  });

  pageViews.forEach(view=>{
    const active=view.dataset.view===page;
    view.hidden=!active;
    view.classList.toggle('is-page-active',active);
  });

  canvas.dataset.page=page;
}

navItems.forEach(button=>button.addEventListener('click',()=>activate(button.dataset.page)));
activate('pipeline');
