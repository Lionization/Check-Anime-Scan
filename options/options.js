/**
 * @fileoverview Gestionnaire de la page d'options pour Check Anime & Scans.
 */

import { getAppSettings, saveAppSettings, CONSTANTS, updateBadgeCount } from '../utils.js';

document.addEventListener('DOMContentLoaded', async () => {
    // Éléments du DOM
    const foldersList = document.getElementById('folders-list');
    const addFolderForm = document.getElementById('add-folder-form');
    const newFolderInput = document.getElementById('new-folder-input');
    const intervalSelect = document.getElementById('interval-select');
    const notificationsToggle = document.getElementById('notifications-toggle');
    const saveBtn = document.getElementById('save-btn');
    const exportBtn = document.getElementById('export-btn');
    const importTriggerBtn = document.getElementById('import-trigger-btn');
    const importFileInput = document.getElementById('import-file-input');
    const toastEl = document.getElementById('toast');

    /** @type {string[]} */
    let currentFolders = [];

    // Chargement initial des paramètres
    await loadSettings();

    /**
     * Charge et affiche les réglages actuels
     */
    async function loadSettings() {
        const settings = await getAppSettings();
        currentFolders = [...settings.targetFolders];
        
        // Sélection de la fréquence
        intervalSelect.value = settings.checkInterval.toString();
        
        // État des notifications
        notificationsToggle.checked = settings.notificationsEnabled;
        
        // Rendu des tags de dossiers
        renderFolderTags();
    }

    /**
     * Effectue le rendu des tags de dossiers avec bouton de suppression
     */
    function renderFolderTags() {
        foldersList.innerHTML = '';

        currentFolders.forEach((folderName, index) => {
            const tag = document.createElement('div');
            tag.className = 'folder-tag';

            const nameSpan = document.createElement('span');
            nameSpan.textContent = folderName;
            tag.appendChild(nameSpan);

            // Bouton supprimer (si plus d'un dossier présent)
            if (currentFolders.length > 1) {
                const removeBtn = document.createElement('button');
                removeBtn.type = 'button';
                removeBtn.className = 'btn-remove-tag';
                removeBtn.setAttribute('aria-label', `Supprimer le dossier ${folderName}`);
                removeBtn.title = `Supprimer ${folderName}`;
                removeBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;

                removeBtn.addEventListener('click', () => {
                    currentFolders.splice(index, 1);
                    renderFolderTags();
                });

                tag.appendChild(removeBtn);
            }

            foldersList.appendChild(tag);
        });
    }

    // Ajout d'un nouveau dossier
    addFolderForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const folderName = newFolderInput.value.trim().toUpperCase();

        if (folderName && !currentFolders.includes(folderName)) {
            currentFolders.push(folderName);
            renderFolderTags();
            newFolderInput.value = '';
        } else if (currentFolders.includes(folderName)) {
            showToast('Ce dossier est déjà dans la liste !', 'warning');
        }
    });

    // Enregistrement des paramètres
    saveBtn.addEventListener('click', async () => {
        saveBtn.disabled = true;

        try {
            const newSettings = {
                checkInterval: parseInt(intervalSelect.value, 10),
                notificationsEnabled: notificationsToggle.checked,
                targetFolders: currentFolders
            };

            await saveAppSettings(newSettings);

            // Informer le background service worker pour réaligner l'alarme
            chrome.runtime.sendMessage({ action: 'reconfigureAlarm' });

            // Forcer une vérification avec les nouveaux dossiers
            chrome.runtime.sendMessage({ action: 'forceCheck' });

            showToast('✅ Paramètres enregistrés avec succès !');
        } catch (error) {
            console.error("Erreur lors de l'enregistrement des paramètres:", error);
            showToast('❌ Erreur lors de la sauvegarde.', 'error');
        } finally {
            saveBtn.disabled = false;
        }
    });

    // =========================================================================
    // EXPORT & IMPORT JSON
    // =========================================================================

    // Exportation
    exportBtn.addEventListener('click', async () => {
        try {
            const allData = await chrome.storage.local.get(null);
            const settings = await getAppSettings();

            const exportPayload = {
                version: '1.0',
                exportedAt: new Date().toISOString(),
                settings: settings,
                data: allData
            };

            const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `check-anime-scans-backup-${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
            URL.revokeObjectURL(url);

            showToast('💾 Sauvegarde exportée avec succès !');
        } catch (error) {
            console.error("Erreur lors de l'exportation:", error);
            showToast("❌ Erreur lors de l'exportation.", 'error');
        }
    });

    // Déclencheur du sélecteur de fichier d'import
    importTriggerBtn.addEventListener('click', () => {
        importFileInput.click();
    });

    // Traitement du fichier importé
    importFileInput.addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (event) => {
            try {
                const json = JSON.parse(event.target?.result);
                if (!json || typeof json !== 'object') {
                    throw new Error("Format JSON invalide");
                }

                // Restauration des réglages et des données
                if (json.data) {
                    await chrome.storage.local.set(json.data);
                }
                if (json.settings) {
                    await saveAppSettings(json.settings);
                }

                await loadSettings();
                const refreshedData = await chrome.storage.local.get(null);
                await updateBadgeCount(refreshedData);

                showToast('✅ Restauration réussie !');
            } catch (err) {
                console.error("Erreur d'importation JSON:", err);
                showToast("❌ Fichier de sauvegarde invalide.", 'error');
            } finally {
                importFileInput.value = '';
            }
        };
        reader.readAsText(file);
    });

    /**
     * Affiche une notification Toast temporaire
     * @param {string} message 
     * @param {'success'|'warning'|'error'} type 
     */
    function showToast(message, type = 'success') {
        toastEl.textContent = message;
        toastEl.style.borderColor = type === 'error' ? 'var(--accent)' : (type === 'warning' ? 'var(--warning)' : 'var(--success)');
        toastEl.classList.remove('hidden');

        setTimeout(() => {
            toastEl.classList.add('hidden');
        }, 3500);
    }
});
