document.addEventListener('DOMContentLoaded', async () => {
    const client = window.bloodBridgeSupabase;
    const faqItems = document.querySelectorAll('.faq-item');
    const faqSearch = document.querySelector('[data-faq-search]');
    const form = document.getElementById('support-form');
    const status = document.getElementById('support-form-status');
    if (!client?.auth) return;

    faqItems.forEach((item) => {
        const question = item.querySelector('.faq-question');
        question?.addEventListener('click', () => {
            item.classList.toggle('active');
            const indicator = question.querySelector('span');
            if (indicator) indicator.textContent = item.classList.contains('active') ? '−' : '+';
        });
    });

    faqSearch?.addEventListener('input', () => {
        const query = faqSearch.value.toLowerCase().trim();
        faqItems.forEach((item) => {
            item.hidden = query && !item.textContent.toLowerCase().includes(query);
        });
    });

    form?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const { data: sessionData } = await client.auth.getSession();
        const user = sessionData?.session?.user;
        if (!user) {
            status.textContent = 'Please log in before sending a support message.';
            status.dataset.type = 'error';
            return;
        }

        const subject = document.getElementById('support-subject').value;
        const message = document.getElementById('support-message').value.trim();
        if (!message) {
            status.textContent = 'Please enter your message.';
            status.dataset.type = 'error';
            return;
        }

        const button = form.querySelector('button[type="submit"]');
        button.disabled = true;
        const { error } = await client.from('support_messages').insert({
            user_id: user.id,
            email: user.email || null,
            subject,
            message
        });
        button.disabled = false;
        if (error) {
            status.textContent = `Message could not be sent: ${error.message}`;
            status.dataset.type = 'error';
            return;
        }
        form.reset();
        status.textContent = 'Message sent successfully.';
        status.dataset.type = 'success';
    });
});
