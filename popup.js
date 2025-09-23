const API_KEY = ""; 

const playlistInput = document.getElementById("playlistUrl");
const keywordInput = document.getElementById("keyword");
const searchBtn = document.getElementById("searchBtn");
const resultsList = document.getElementById("results");
const errorMessage = document.getElementById("errorMessage");
const loadingIndicator = document.getElementById("loading");
const progressIndicator = document.getElementById("progressIndicator");
const themeToggle = document.getElementById("themeToggle");
const body = document.body;

let allVideos = [];
let currentPlaylistId = null;
let fetchInProgress = false;

function showError(message) {
    errorMessage.textContent = message;
    errorMessage.classList.remove("hidden");
}

function hideError() {
    errorMessage.classList.add("hidden");
}

function showProgress(current, total, status = "Fetching videos") {
    progressIndicator.textContent = `${status}... ${current}/${total}`;
    progressIndicator.classList.remove("hidden");
}

function hideProgress() {
    progressIndicator.classList.add("hidden");
}

function updateLoadingState(isLoading, message = "🔍 Searching...") {
    if (isLoading) {
        loadingIndicator.textContent = message;
        loadingIndicator.classList.remove("hidden");
        searchBtn.disabled = true;
        searchBtn.textContent = "Loading...";
    } else {
        loadingIndicator.classList.add("hidden");
        hideProgress();
        searchBtn.disabled = false;
        searchBtn.textContent = "Search";
    }
}

function clearUI() {
    resultsList.innerHTML = "";
    hideError();
    hideProgress();
}

function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function highlightKeyword(text, keyword) {
    const safeKeyword = escapeRegExp(keyword);
    const regex = new RegExp(`(${safeKeyword})`, "gi");
    return text.replace(regex, `<span class="highlight">$1</span>`);
}

function extractPlaylistId(url) {
    try {
        const urlObj = new URL(url);
        return urlObj.searchParams.get("list");
    } catch {
        return null;
    }
}

async function fetchWithRetry(url, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(url);
            if (response.ok) return await response.json();
            if (response.status === 403) {
                throw new Error("API quota exceeded. Please try again later.");
            }
        } catch (error) {
            if (i === retries - 1) throw error;
            await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1))); 
        }
    }
}

async function getPlaylistInfo(playlistId) {
    try {
        const url = `https://www.googleapis.com/youtube/v3/playlists?part=snippet,contentDetails&id=${playlistId}&key=${API_KEY}`;
        const data = await fetchWithRetry(url);
        
        if (data.error) {
            throw new Error(data.error.message);
        }
        
        if (!data.items || data.items.length === 0) {
            throw new Error("Playlist not found or is private");
        }
        
        return {
            title: data.items[0].snippet.title,
            totalVideos: data.items[0].contentDetails.itemCount
        };
    } catch (error) {
        throw new Error(`Failed to get playlist info: ${error.message}`);
    }
}

async function fetchPlaylistVideos(playlistId) {
    let videos = [];
    let nextPageToken = "";
    let playlistInfo = null;

    try {
        updateLoadingState(true, "🔍 Getting playlist info...");
        playlistInfo = await getPlaylistInfo(playlistId);
        const totalVideos = parseInt(playlistInfo.totalVideos);
        
        updateLoadingState(true, `📥 Loading ${playlistInfo.title}`);
        showProgress(0, totalVideos, "Fetching videos");

        do {
            const url =
                `https://www.googleapis.com/youtube/v3/playlistItems?` +
                `part=snippet&maxResults=50&playlistId=${playlistId}&key=${API_KEY}&pageToken=${nextPageToken}`;

            const data = await fetchWithRetry(url);

            if (data.error) {
                throw new Error(data.error.message || "Failed to fetch playlist items");
            }

            if (!data.items || data.items.length === 0) {
                if (videos.length === 0) {
                    throw new Error("No videos found in this playlist");
                }
                break;
            }

            hideError();

            for (const item of data.items) {
                if (item.snippet.title === "Deleted video" || item.snippet.title === "Private video") {
                    continue;
                }
                
                videos.push({
                    id: item.snippet.resourceId.videoId,
                    title: item.snippet.title,
                    description: item.snippet.description || "",
                    thumbnail: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url || "default-thumbnail.jpg",
                    publishedAt: item.snippet.publishedAt
                });
            }

            showProgress(videos.length, totalVideos, "Fetching videos");

            nextPageToken = data.nextPageToken || "";
            
            if (nextPageToken) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            
        } while (nextPageToken);

        showProgress(videos.length, videos.length, "Complete");
        
    } catch (error) {
        console.error("Fetch Error:", error);
        showError(`❌ ${error.message}`);
        return [];
    }

    return videos;
}

function renderResults(videos, keyword) {
    if (!keyword) {
        resultsList.innerHTML = "";
        return;
    }

    const filteredVideos = videos.filter(video =>
        video.title.toLowerCase().includes(keyword) ||
        video.description.toLowerCase().includes(keyword)
    );

    resultsList.innerHTML = "";

    if (filteredVideos.length === 0) {
        if (videos.length === 0) {
            showError("⚠️ No videos loaded yet. Please enter a playlist URL first.");
        } else {
            showError(`⚠️ No matching videos found for "${keyword}". Showing 0 of ${videos.length} videos.`);
        }
        return;
    }

    hideError();

    const resultCount = document.createElement("div");
    resultCount.className = "result-count";
    resultCount.textContent = `Found ${filteredVideos.length} of ${videos.length} videos`;
    resultsList.appendChild(resultCount);

    const fragment = document.createDocumentFragment();

    for (const video of filteredVideos) {
        const highlightedTitle = highlightKeyword(video.title, keyword);
        const listItem = document.createElement("li");
        listItem.innerHTML = `
            <a href="https://www.youtube.com/watch?v=${video.id}" target="_blank" class="video-item">
                <img src="${video.thumbnail}" alt="Thumbnail" class="video-thumbnail" loading="lazy">
                <div class="video-info">
                    <span class="video-title">${highlightedTitle}</span>
                    <span class="video-date">${new Date(video.publishedAt).toLocaleDateString()}</span>
                </div>
            </a>
        `;
        fragment.appendChild(listItem);
    }

    resultsList.appendChild(fragment);
}

async function handlePlaylistInput() {
    const playlistUrl = playlistInput.value.trim();
    
    if (!playlistUrl) {
        clearUI();
        allVideos = [];
        currentPlaylistId = null;
        return;
    }

    const playlistId = extractPlaylistId(playlistUrl);

    if (!playlistId) {
        showError("❌ Please enter a valid YouTube playlist URL");
        return;
    }

    if (playlistId === currentPlaylistId) return;

    currentPlaylistId = playlistId;
    allVideos = [];
    fetchInProgress = true;
    clearUI();

    allVideos = await fetchPlaylistVideos(playlistId);

    fetchInProgress = false;
    updateLoadingState(false);
    
    const keyword = keywordInput.value.trim().toLowerCase();
    if (keyword) {
        renderResults(allVideos, keyword);
    }
}

function handleKeywordInput() {
    const keyword = keywordInput.value.trim().toLowerCase();
    if (allVideos.length > 0) {
        renderResults(allVideos, keyword);
    }
}

function handleSearch() {
    const playlistUrl = playlistInput.value.trim();
    const keyword = keywordInput.value.trim();
    
    if (!playlistUrl) {
        showError("❌ Please enter a playlist URL");
        playlistInput.focus();
        return;
    }
    
    if (!keyword) {
        showError("❌ Please enter a keyword to search");
        keywordInput.focus();
        return;
    }
    
    if (extractPlaylistId(playlistUrl) !== currentPlaylistId) {
        handlePlaylistInput();
    } else {
        renderResults(allVideos, keyword.toLowerCase());
    }
}

function debounce(fn, delay = 400) {
    let timeout;
    return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => fn.apply(this, args), delay);
    };
}

function applyTheme(theme) {
    body.classList.remove("light-mode", "dark-mode");
    body.classList.add(theme);
    localStorage.setItem("theme", theme);
    themeToggle.textContent = theme === "light-mode" ? "🌙 Dark Mode" : "☀️ Light Mode";
}

function handleKeyPress(event) {
    if (event.key === "Enter") {
        if (event.target === playlistInput || event.target === keywordInput) {
            handleSearch();
        }
    }
}

document.addEventListener("DOMContentLoaded", () => {
    if (typeof chrome !== 'undefined' && chrome.tabs) {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs.length > 0 && tabs[0].url.includes("youtube.com/playlist")) {
                playlistInput.value = tabs[0].url;
                handlePlaylistInput();
            }
        });
    }

    playlistInput.addEventListener("input", debounce(handlePlaylistInput, 800));
    keywordInput.addEventListener("input", debounce(handleKeywordInput, 300));
    searchBtn.addEventListener("click", handleSearch);
    
    playlistInput.addEventListener("keypress", handleKeyPress);
    keywordInput.addEventListener("keypress", handleKeyPress);

    const savedTheme = localStorage.getItem("theme") || "dark-mode";
    applyTheme(savedTheme);

    themeToggle.addEventListener("click", () => {
        const newTheme = body.classList.contains("light-mode") ? "dark-mode" : "light-mode";
        applyTheme(newTheme);
    });
    
    playlistInput.focus();
});