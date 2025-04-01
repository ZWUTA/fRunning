// ==UserScript==
// @name         硅胶跑步（增强版）
// @run-at       document-end
// @namespace    http://tampermonkey.net/
// @version      0.2
// @description  增强跑步功能：语音播报 + 设置面板
// @author       AndreaFrederica
// @match        http://tiyu.zwu.edu.cn/*
// @require      http://code.jquery.com/jquery-1.11.0.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/crypto-js/4.1.1/crypto-js.min.js
// @grant        unsafeWindow
// ==/UserScript==

(function () {
    "use strict";
    var enable_dark_mode = false
    const SIGN_SECRET = "1q@#@$%)@(!";

    var data = {
        effectiveDistance: 0,
        ineffectiveDistance: 0,
        speed: 0,
        done: false
    };

    // 默认设置
    const defaultTargetDistance = 2500;
    const defaultSoundEnabled = true;
    const defaultVibrateEnabled = true;
    const defaultVoiceEnabled = true;
    const defaultPollInterval = 1000;
    const defaultforceDarkModeEnabled = true;
    const defaultautoDarkModeEnabled = true;
    const calculateDuration = ({ startTime, endTime }) => {
        // 将时间字符串分割为小时和分钟，并转换为数字
        const [startHour, startMinute] = startTime.split(':').map(Number);
        const [endHour, endMinute] = endTime.split(':').map(Number);

        // 计算自午夜起的总分钟数
        const startTotal = startHour * 60 + startMinute;
        const endTotal = endHour * 60 + endMinute;

        // 计算差值（分钟数）
        let diff = endTotal - startTotal;
        // 如果差值为负，表示跨天，则加上 24 小时的分钟数
        if (diff < 0) diff += 24 * 60;

        // 计算相差的小时和分钟
        const hours = Math.floor(diff / 60);
        const minutes = diff % 60;

        // 返回格式化后的字符串（确保2位数显示）
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
    };

    /**
     * 计算剩余时间
     * @param {Object} info - 包含平均配速和有效距离
     * @param {number} info.averagePace - 平均配速，单位：秒/公里
     * @param {number} info.effectiveDistance - 已跑的有效距离，单位：米
     * @param {number} targetDistance - 目标里程，单位：米
     * @returns {string} 剩余时间，格式为 "分'秒\""
     */
    const calculateRemainingTime = ({ averagePace, effectiveDistance }, targetDistance) => {
        // 计算剩余距离（米）
        const remainingDistance = targetDistance - effectiveDistance;
        if (remainingDistance <= 0) return "0'00\"";  // 如果已达到或超过目标里程

        // 计算剩余时间（秒）
        const remainingTimeSec = (remainingDistance / 1000) * averagePace;

        // 转换为分钟和秒
        const minutes = Math.floor(remainingTimeSec / 60);
        const seconds = Math.round(remainingTimeSec % 60);

        return `${minutes}'${seconds < 10 ? '0' : ''}${seconds}"`;
    };

    // 示例：目标里程 10000 米，有效距离 3000 米，平均配速 330 秒/公里
    console.log(calculateRemainingTime({ averagePace: 330, effectiveDistance: 3000 }, 10000));
    // 计算逻辑：剩余距离 7000 米，7000/1000 = 7 公里，7 * 330 = 2310 秒，转换为 38'30"


    // 增强版提示音函数（带错误处理）
    const beep = ({
        duration = 500,
        frequency = 440,
        volume = 0.8,
        type = "sine",
        callback,
    } = {}) => {
        try {
            const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = audioCtx.createOscillator();
            const gainNode = audioCtx.createGain();

            oscillator.connect(gainNode);
            gainNode.connect(audioCtx.destination);

            gainNode.gain.value = Math.min(1, Math.max(0, volume));
            oscillator.frequency.value = frequency;
            oscillator.type = type;

            if (typeof callback === "function") {
                oscillator.onended = callback;
            }

            oscillator.start();
            oscillator.stop(audioCtx.currentTime + duration / 1000);
        } catch (error) {
            console.error("音频播放失败:", error);
        }
    };
    window.beep = beep;

    // 场景提示音配置 ==================================

    // 1. 开始跑步提示音 (激励上升音效)
    const startRunTone = () =>
        beep({
            frequency: 784, // G5 音高
            duration: 800,
            type: "sine",
            volume: 0.7,
            callback: () =>
                beep({
                    // 添加二次确认音
                    frequency: 1046, // C6
                    duration: 300,
                }),
        });
    window.startRunTone = startRunTone;

    // 2. 完成目标提示音 (胜利音效)
    const finishRunTone = () => {
        beep({ frequency: 523, duration: 300 }); // C5
        setTimeout(() => {
            beep({ frequency: 659, duration: 300 }); // E5
            setTimeout(() => {
                beep({ frequency: 784, duration: 500 }); // G5
            }, 200);
        }, 150);
    };
    window.finishRunTone = finishRunTone;

    // 3. 打卡成功提示音 (确认音)
    const checkSuccessTone = () =>
        beep({
            frequency: 1318, // E6
            duration: 150,
            type: "square",
            volume: 0.6,
        });
    window.checkSuccessTone = checkSuccessTone;

    // 4. 打卡失败提示音 (警告音)
    const checkFailTone = () => {
        beep({
            frequency: 220, // A3
            duration: 400,
            type: "sawtooth",
            volume: 0.9,
        });
        setTimeout(() => {
            beep({
                frequency: 196, // G3
                duration: 400,
                type: "sawtooth",
            });
        }, 100);
    };
    window.checkFailTone = checkFailTone;



    // 读取本地存储的设置，如无则使用默认值
    let soundEnabled = localStorage.getItem('soundEnabled') !== null ? JSON.parse(localStorage.getItem('soundEnabled')) : defaultSoundEnabled;
    let vibrateEnabled = localStorage.getItem('vibrateEnabled') !== null ? JSON.parse(localStorage.getItem('vibrateEnabled')) : defaultVibrateEnabled;
    let voiceEnabled = localStorage.getItem('voiceEnabled') !== null ? JSON.parse(localStorage.getItem('voiceEnabled')) : defaultVoiceEnabled;
    let forceDarkModeEnabled = localStorage.getItem('forceDarkModeEnabled') !== null ? JSON.parse(localStorage.getItem('forceDarkModeEnabled')) : defaultforceDarkModeEnabled;
    let autoDarkModeEnabled = localStorage.getItem('autoDarkModeEnabled') !== null ? JSON.parse(localStorage.getItem('autoDarkModeEnabled')) : defaultautoDarkModeEnabled;
    let targetDistance = localStorage.getItem('targetDistance') !== null ? parseInt(localStorage.getItem('targetDistance')) : defaultTargetDistance;
    if (isNaN(targetDistance) || targetDistance <= 0) targetDistance = defaultTargetDistance;
    let pollInterval = localStorage.getItem('pollInterval') !== null ? parseInt(localStorage.getItem('pollInterval')) : defaultPollInterval;
    if (isNaN(pollInterval) || pollInterval < 100) pollInterval = defaultPollInterval;

    // 语音播报函数（Web Speech API）
    function speak(text) {
        if (!voiceEnabled) return;
        if ('speechSynthesis' in window) {
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.lang = 'zh-CN';
            window.speechSynthesis.speak(utterance);
        }
    }

    // 配速格式转换（秒 -> X'XX"）
    function formatPace(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}'${secs.toString().padStart(2, '0')}"`;
    }

    // 语音播报进度跟踪变量
    let voiceInitialDone = false;
    let nextAnnounceDistance = 400;

    // 轮询定时器及学校信息
    let pollIntervalId = null;
    let currentSchool;

    function isEmpty(val) {
        return val === undefined || val === null;
    }
    function isObject(val) {
        return Object.prototype.toString.call(val) === "[object Object]";
    }
    function isArray(val) {
        return Object.prototype.toString.call(val) === "[object Array]";
    }
    function sortParams(obj) {
        const sorted = {};
        Object.keys(obj).sort().forEach((key) => {
            const value = obj[key];
            if (isObject(value)) {
                sorted[key] = sortParams(value);
            } else if (isArray(value)) {
                sorted[key] = sortArray(value);
            } else if (isEmpty(value)) {
                sorted[key] = "";
            } else {
                sorted[key] = String(value);
            }
        });
        return sorted;
    }
    function sortArray(arr) {
        return arr.map((item) => {
            if (isObject(item)) return sortParams(item);
            if (isArray(item)) return sortArray(item);
            return isEmpty(item) ? "" : String(item);
        }).sort();
    }
    function serializeValue(val) {
        if (isArray(val)) return serializeArray(val);
        if (isObject(val)) return serializeObject(val);
        return val;
    }
    function serializeObject(obj) {
        const parts = [];
        for (const key in obj) {
            if (obj.hasOwnProperty(key)) {
                if (isEmpty(obj[key])) continue;
                parts.push(`${key}=${serializeValue(obj[key])}`);
            }
        }
        return parts.join("&");
    }
    function serializeArray(arr) {
        const parts = [];
        arr.forEach((item) => {
            if (!isEmpty(item)) {
                parts.push(serializeValue(item));
            }
        });
        return parts.join("&");
    }
    function createSign(params, secret) {
        const sortedParams = sortParams(params);
        const serialized = serializeObject(sortedParams);
        const hash = CryptoJS.HmacSHA1(serialized, secret);
        return CryptoJS.enc.Base64.stringify(hash);
    }
    function getTodayDate() {
        let date = new Date(),
            year = date.getFullYear(),
            month = date.getMonth() + 1,
            day = date.getDate();
        month = month < 10 ? "0" + month : month;
        day = day < 10 ? "0" + day : day;
        return `${year}-${month}-${day}`;
    }
    function getTime() {
        return Date.now();
    }
    function getParam(params, time) {
        return { ...params, time: time };
    }

    async function getSchool() {
        const yearMonthDay = getTodayDate();
        //const studentId =  (JSON.parse(localStorage.getItem('vuex') || 'null') || {})['fitness-user']?.userInfo?.userId;
        const device = window.localStorage.getItem("deviceId");
        if (!device) return;
        const time = getTime();
        const resp = await fetch("/evaluation/school/getLocalSchool", {
            method: "POST",
            headers: {
                Sign: createSign(getParam({}, time), SIGN_SECRET),
                Timestamp: time,
            },
            body: JSON.stringify({}),
        });
        return await resp.json();
    }

    async function getTerm(sch) {
        const yearMonthDay = getTodayDate();
        // const studentId = "1500000100281732182";
        const studentId = (JSON.parse(localStorage.getItem('vuex') || 'null') || {})['fitness-user']?.userInfo?.userId;
        const device = window.localStorage.getItem("deviceId");
        if (!device) return;
        const time = getTime();
        const b = {
            startTime: sch.data.termInfo.startTime,
            endTime: sch.data.termInfo.endTime,
            studentId: studentId,
        };
        const resp = await fetch("/evaluation/runningStatistic/getStudentTermRecord", {
            method: "POST",
            headers: {
                Sign: createSign(
                    getParam(b, time),
                    SIGN_SECRET
                ),
                Timestamp: time,
                Accept: "application/json, text/plain, */*",
                "Accept-Encoding": "gzip, deflate",
                Connection: "keep-alive",
                Appid: "spe-miniprogram-fitness",
                'content-type': 'application/json',
            },
            body: JSON.stringify(b),
        });
        return await resp.json();
    }

    async function getDaily(sch) {
        const yearMonthDay = getTodayDate();
        const studentId = (JSON.parse(localStorage.getItem('vuex') || 'null') || {})['fitness-user']?.userInfo?.userId;
        const device = window.localStorage.getItem("deviceId");
        if (!device) return;
        const time = getTime();
        const b = {
            schoolId: sch.data.termInfo.schoolId,
            studentId: studentId,
            yearMonthDay: yearMonthDay,
        };
        const resp = await fetch("/evaluation/runningStatistic/getStudentDailyDetail", {
            method: "POST",
            headers: {
                Sign: createSign(
                    getParam(b, time),
                    SIGN_SECRET
                ),
                Timestamp: time,
                Accept: "application/json, text/plain, */*",
                "Accept-Encoding": "gzip, deflate",
                Connection: "keep-alive",
                Appid: "spe-miniprogram-fitness",
                'content-type': 'application/json',
            },
            body: JSON.stringify(b),
        });
        return await resp.json();
    }

    // 轮询最新跑步数据并更新UI
    async function poll(sch, panel) {
        const rec = await getTerm(sch);
        const day = await getDaily(sch);
        if (day.data.length === 0) {
            day.data[0] = {
                "startTime": "00:00",
                "endTime": "00:00",
                "effectiveDistance": 0,
                "speed": 0,
                "ineffectiveDistance": 0
            };
            console.log("今天还没跑步");
        }
        let d_end = day.data[day.data.length - 1];
        d_end["usedTime"] = calculateDuration({ startTime: d_end["startTime"], endTime: d_end["endTime"] })
        panel.updateData(d_end);

        if (d_end.effectiveDistance !== data.effectiveDistance) {
            if (data.effectiveDistance === 0 && data.ineffectiveDistance === 0) {
                if (soundEnabled) startRunTone();
                if (vibrateEnabled) navigator.vibrate([200, 100, 300]);
                voiceInitialDone = false;
                nextAnnounceDistance = 400;
            } else {
                if (d_end.effectiveDistance >= targetDistance && data.done === false) {
                    if (soundEnabled) finishRunTone();
                    if (vibrateEnabled) navigator.vibrate([200, 100, 300, 200, 100, 300, 200, 100, 300, 200, 100, 300]);
                    data.done = true;
                    console.log("跑完了");
                    speak(`目标已完成！您已跑步 ${d_end.effectiveDistance}米，距离目标还剩 ${Math.max(targetDistance - d_end.effectiveDistance, 0)}米，已完成进度的 ${(Math.min(d_end.effectiveDistance / targetDistance, 1) * 100).toFixed(1)}%，配速 ${formatPace(d_end.speed)}`);
                } else {
                    if (soundEnabled) checkSuccessTone();
                    if (vibrateEnabled) navigator.vibrate([200, 100, 300]);
                    if (voiceEnabled) {
                        if (!voiceInitialDone && d_end.effectiveDistance < 400) {
                            speak(`配速 ${formatPace(d_end.speed)}，已完成进度的 ${(Math.min(d_end.effectiveDistance / targetDistance, 1) * 100).toFixed(1)}%`);
                            voiceInitialDone = true;
                        } else if (d_end.effectiveDistance >= nextAnnounceDistance) {
                            speak(`您已跑步 ${d_end.effectiveDistance}米，距离目标还剩 ${Math.max(targetDistance - d_end.effectiveDistance, 0)}米，已完成进度的 ${(Math.min(d_end.effectiveDistance / targetDistance, 1) * 100).toFixed(1)}%，配速 ${formatPace(d_end.speed)}`);
                            nextAnnounceDistance += 400;
                        }
                    }
                }
            }
            data.effectiveDistance = d_end.effectiveDistance;
        }
        if (d_end.ineffectiveDistance !== data.ineffectiveDistance) {
            if (d_end.effectiveDistance !== data.effectiveDistance) {
                if (data.effectiveDistance === 0 && data.ineffectiveDistance === 0) {
                    if (soundEnabled) startRunTone();
                    if (vibrateEnabled) navigator.vibrate([200, 100, 300]);
                    if (d_end.effectiveDistance >= targetDistance && data.done === false) {
                        if (soundEnabled) finishRunTone();
                        if (vibrateEnabled) navigator.vibrate([200, 100, 300, 200, 100, 300, 200, 100, 300, 200, 100, 300]);
                        data.done = true;
                        console.log("跑完了");
                        speak(`目标已完成！您已跑步 ${d_end.effectiveDistance}米，距离目标还剩 ${Math.max(targetDistance - d_end.effectiveDistance, 0)}米，已完成进度的 ${(Math.min(d_end.effectiveDistance / targetDistance, 1) * 100).toFixed(1)}%，配速 ${formatPace(d_end.speed)}`);
                    }
                } else {
                    if (soundEnabled) checkFailTone();
                    if (vibrateEnabled) navigator.vibrate([200, 100, 300, 100, 200, 100, 300]);
                }
                data.ineffectiveDistance = d_end.ineffectiveDistance;
            }
            console.log(day);
        }
    }

    $(() => {
        function createRunStatsComponent(initialData) {
            const elements = {};

            // 容器创建
            const container = document.createElement('div');
            container.id = 'run-stats-container';

            // 基础样式
            Object.assign(container.style, {
                position: 'fixed',
                bottom: '80px',
                left: '50%',
                transform: 'translateX(-50%)',
                zIndex: '10000',
                width: '80%',
                maxWidth: '600px',
                boxSizing: 'border-box',
                padding: '20px',
                borderRadius: '12px',
                boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
                fontFamily: 'system-ui, sans-serif',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
                transition: 'opacity 0.3s ease, transform 0.3s ease',
                opacity: '1',
                fontSize: '20px'
            });

            // 创建进度条容器和进度条文字
            const progressContainer = document.createElement('div');
            Object.assign(progressContainer.style, {
                height: '20px',
                backgroundColor: '#e0e0e0',
                borderRadius: '10px',
                overflow: 'hidden',
                position: 'relative',
                marginTop: '12px'
            });
            const progressBar = document.createElement('div');
            Object.assign(progressBar.style, {
                height: '100%',
                width: '0%',
                backgroundColor: '#4CAF50',
                transition: 'width 0.3s ease',
                position: 'absolute'
            });
            const progressText = document.createElement('div');
            Object.assign(progressText.style, {
                position: 'absolute',
                width: '100%',
                textAlign: 'center',
                fontSize: '14px',
                fontWeight: 'bold',
                // color: '#ffffff',
                // textShadow: '0 1px 2px rgba(0, 0, 0, 0.3)',
                zIndex: 1
            });
            progressContainer.append(progressText, progressBar);
            elements.progressBar = progressBar;
            elements.progressText = progressText;

            // 响应式宽度调整
            const updateWidth = () => {
                container.style.width = window.innerWidth < 768 ? '90%' : '80%';
                container.style.maxWidth = '600px';
            };
            updateWidth();
            window.addEventListener('resize', updateWidth);
            container.style.overflowX = 'hidden';
            container.style.textOverflow = 'ellipsis';

            // 创建数据内容容器和设置内容容器
            const statsContent = document.createElement('div');
            statsContent.style.display = 'flex';
            statsContent.style.flexDirection = 'column';
            statsContent.style.gap = '12px';
            const settingsContent = document.createElement('div');
            settingsContent.style.display = 'none';
            settingsContent.style.flexDirection = 'column';
            settingsContent.style.gap = '12px';

            // // 辅助函数：接收需要修改的 class 名称以及是否为暗黑模式
            // function modifyElementsByClass(className, isDark) {
            //     const elements = document.getElementsByClassName(className);
            //     for (let element of elements) {
            //     if (isDark) {
            //         // 模拟 Dark Reader 效果：颜色反转和色调旋转
            //         element.style.filter = 'invert(0.9) hue-rotate(180deg)';
            //         // 也可以根据需求调整其他样式，如背景色、边框等
            //     } else {
            //         // 清除样式，恢复默认状态
            //         element.style.filter = '';
            //     }
            //     }
            // }

            // //TODO 主题适配
            // const applyTheme = (isDark) => {
            //     if (isDark) {
            //         enable_dark_mode = true
            //         container.style.backgroundColor = '#2d2d2d';
            //         container.style.color = '#ffffff';
            //         container.style.boxShadow = '0 4px 6px rgba(255, 255, 255, 0.1)';
            //         progressContainer.style.backgroundColor = '#404040';
            //         progressBar.style.backgroundColor = '#66bb6a';
            //     } else {
            //         enable_dark_mode = false
            //         container.style.backgroundColor = '#ffffff';
            //         container.style.color = '#333333';
            //         container.style.boxShadow = '0 4px 6px rgba(0, 0, 0, 0.1)';
            //         progressContainer.style.backgroundColor = '#f0f0f0';
            //         progressBar.style.backgroundColor = '#4CAF50';
            //     }
            //     modifyElementsByClass()
            // };

            // 辅助函数：修改指定 class 下所有元素的背景色和文字颜色
            function modifyElementsByClass(className, isDark, darkColors, lightColors) {
                // 获取所有带有该 class 的元素
                const parentElements = document.getElementsByClassName(className);
                for (let parent of parentElements) {
                    // 包含父元素和其所有后代元素
                    const allElements = [parent, ...parent.querySelectorAll('*')];
                    allElements.forEach(el => {
                        console.log(el, enable_dark_mode)
                        if (isDark) {
                            // 设置暗黑模式颜色，颜色配置参照主函数
                            el.style.backgroundColor = darkColors.background;
                            el.style.color = darkColors.color;
                        } else {
                            // 恢复为亮色模式颜色
                            el.style.backgroundColor = lightColors.background;
                            el.style.color = lightColors.color;
                        }
                    });
                }
            }

            const darkColors = {
                background: '#2d2d2d',
                color: '#ffffff'
            };
            const lightColors = {
                background: '#ffffff',
                color: '#333333'
            };
            // 主函数中定义的主题适配函数
            // 这里的颜色设置和 box-shadow 等样式与页面整体保持一致
            const applyTheme = (isDark) => {
                let flag_enable = true
                if (isDark) { flag_enable = true } else { flag_enable = false }
                // 定义主题颜色配置，确保辅助函数与主函数颜色一致
                if (flag_enable && autoDarkModeEnabled) {
                    enable_dark_mode = true;
                    container.style.backgroundColor = darkColors.background;
                    container.style.color = darkColors.color;
                    container.style.boxShadow = '0 4px 6px rgba(255, 255, 255, 0.1)';
                    progressContainer.style.backgroundColor = '#404040';
                    progressBar.style.backgroundColor = '#66bb6a';
                } else {
                    enable_dark_mode = false;
                    container.style.backgroundColor = lightColors.background;
                    container.style.color = lightColors.color;
                    container.style.boxShadow = '0 4px 6px rgba(0, 0, 0, 0.1)';
                    progressContainer.style.backgroundColor = '#f0f0f0';
                    progressBar.style.backgroundColor = '#4CAF50';
                }
            };

            const observer = new MutationObserver(() => {
                if (forceDarkModeEnabled && autoDarkModeEnabled) {
                    modifyElementsByClass('g-student-result', enable_dark_mode, darkColors, lightColors);
                    modifyElementsByClass('van-collapse-item', enable_dark_mode, darkColors, lightColors);
                }
            });
            observer.observe(document.querySelector("#app"), { subtree: true, childList: true })


            // 初始主题设置
            applyTheme(window.matchMedia('(prefers-color-scheme: dark)').matches);

            // 监听系统主题变化
            window.matchMedia('(prefers-color-scheme: dark)').addListener(e => {
                applyTheme(e.matches);
            });

            // 填充数据内容容器
            statsContent.append(
                createStatRow('🏃 开始时间', initialData.startTime, 'startTime'),
                createStatRow('🎯 结束时间', initialData.endTime, 'endTime'),
                createStatRow('⏱️ 总计用时', initialData.usedTime, 'usedTime'),//TODO在加总计时间
                createStatRow('⏳ 预计剩余', "undefined", 'RemainingTime'),//TODO在加总计时间
                createStatRow('⏲️ 平均配速', formatPace(initialData.speed), 'speed'),
                createStatRow('✅ 有效距离', `${initialData.effectiveDistance}m`, 'effectiveDistance'),
                createStatRow('⚠️ 无效距离', `${initialData.ineffectiveDistance}m`, 'ineffectiveDistance'),
                progressContainer
            );

            // 创建选项卡栏
            const tabBar = document.createElement('div');
            Object.assign(tabBar.style, {
                display: 'flex',
                justifyContent: 'center',
                gap: '10px',
                borderBottom: '1px solid #ccc'
            });
            const tabButtonStats = document.createElement('button');
            tabButtonStats.textContent = '数据';
            const tabButtonSettings = document.createElement('button');
            tabButtonSettings.textContent = '设置';
            const tabButtonStyle = {
                flex: '1',
                padding: '8px 0',
                backgroundColor: 'transparent',
                border: 'none',
                borderBottom: '2px solid transparent',
                cursor: 'pointer',
                fontWeight: 'bold'
            };
            Object.assign(tabButtonStats.style, tabButtonStyle);
            Object.assign(tabButtonSettings.style, tabButtonStyle);
            tabButtonStats.style.borderBottomColor = '#4CAF50';
            tabBar.append(tabButtonStats, tabButtonSettings);

            // 选项卡切换事件
            tabButtonStats.addEventListener('click', () => {
                statsContent.style.display = 'flex';
                settingsContent.style.display = 'none';
                tabButtonStats.style.borderBottomColor = '#4CAF50';
                tabButtonSettings.style.borderBottomColor = 'transparent';
            });
            tabButtonSettings.addEventListener('click', () => {
                statsContent.style.display = 'none';
                settingsContent.style.display = 'flex';
                tabButtonSettings.style.borderBottomColor = '#4CAF50';
                tabButtonStats.style.borderBottomColor = 'transparent';
            });

            // 提示音开关
            const soundCheckbox = document.createElement('input');
            soundCheckbox.type = 'checkbox';
            soundCheckbox.checked = soundEnabled;
            soundCheckbox.style.marginRight = '6px';
            const soundLabel = document.createElement('label');
            soundLabel.style.display = 'flex';
            soundLabel.style.alignItems = 'center';
            soundLabel.style.cursor = 'pointer';
            soundLabel.append(soundCheckbox, document.createTextNode(' 提示音'));
            settingsContent.appendChild(soundLabel);
            soundCheckbox.addEventListener('change', () => {
                soundEnabled = soundCheckbox.checked;
                localStorage.setItem('soundEnabled', JSON.stringify(soundEnabled));
            });

            // 震动开关
            const vibrateCheckbox = document.createElement('input');
            vibrateCheckbox.type = 'checkbox';
            vibrateCheckbox.checked = vibrateEnabled;
            vibrateCheckbox.style.marginRight = '6px';
            const vibrateLabel = document.createElement('label');
            vibrateLabel.style.display = 'flex';
            vibrateLabel.style.alignItems = 'center';
            vibrateLabel.style.cursor = 'pointer';
            vibrateLabel.append(vibrateCheckbox, document.createTextNode(' 震动'));
            settingsContent.appendChild(vibrateLabel);
            vibrateCheckbox.addEventListener('change', () => {
                vibrateEnabled = vibrateCheckbox.checked;
                localStorage.setItem('vibrateEnabled', JSON.stringify(vibrateEnabled));
            });

            // 语音播报开关
            const voiceCheckbox = document.createElement('input');
            voiceCheckbox.type = 'checkbox';
            voiceCheckbox.checked = voiceEnabled;
            voiceCheckbox.style.marginRight = '6px';
            const voiceLabel = document.createElement('label');
            voiceLabel.style.display = 'flex';
            voiceLabel.style.alignItems = 'center';
            voiceLabel.style.cursor = 'pointer';
            voiceLabel.append(voiceCheckbox, document.createTextNode(' 语音播报'));
            settingsContent.appendChild(voiceLabel);
            voiceCheckbox.addEventListener('change', () => {
                voiceEnabled = voiceCheckbox.checked;
                localStorage.setItem('voiceEnabled', JSON.stringify(voiceEnabled));
            });
            // 自动暗色模式开关
            const autoDarkModeCheckbox = document.createElement('input');
            autoDarkModeCheckbox.type = 'checkbox';
            autoDarkModeCheckbox.checked = autoDarkModeEnabled;
            autoDarkModeCheckbox.style.marginRight = '6px';
            const autoDarkModeLabel = document.createElement('label');
            autoDarkModeLabel.style.display = 'flex';
            autoDarkModeLabel.style.alignItems = 'center';
            autoDarkModeLabel.style.cursor = 'pointer';
            autoDarkModeLabel.append(autoDarkModeCheckbox, document.createTextNode(' 自动暗色模式'));
            settingsContent.appendChild(autoDarkModeLabel);
            autoDarkModeCheckbox.addEventListener('change', () => {
                autoDarkModeEnabled = autoDarkModeCheckbox.checked;
                localStorage.setItem('autoDarkModeEnabled', JSON.stringify(autoDarkModeEnabled));
            });
            // 自动暗色模式开关
            const forceDarkModeCheckbox = document.createElement('input');
            forceDarkModeCheckbox.type = 'checkbox';
            forceDarkModeCheckbox.checked = forceDarkModeEnabled;
            forceDarkModeCheckbox.style.marginRight = '6px';
            const forceDarkModeLabel = document.createElement('label');
            forceDarkModeLabel.style.display = 'flex';
            forceDarkModeLabel.style.alignItems = 'center';
            forceDarkModeLabel.style.cursor = 'pointer';
            forceDarkModeLabel.append(forceDarkModeCheckbox, document.createTextNode(' 强制APP应用暗色模式'));
            settingsContent.appendChild(forceDarkModeLabel);
            forceDarkModeCheckbox.addEventListener('change', () => {
                forceDarkModeEnabled = forceDarkModeCheckbox.checked;
                localStorage.setItem('forceDarkModeEnabled', JSON.stringify(forceDarkModeEnabled));
            });

            // 目标距离选择（1500/2500/自定义）
            const distDiv = document.createElement('div');
            distDiv.style.display = 'flex';
            distDiv.style.alignItems = 'center';
            distDiv.style.gap = '6px';
            const distLabel = document.createElement('span');
            distLabel.textContent = '目标距离:';
            const radioLabel1500 = document.createElement('label');
            radioLabel1500.style.cursor = 'pointer';
            const radio1500 = document.createElement('input');
            radio1500.type = 'radio';
            radio1500.name = 'targetDistanceOption';
            radio1500.value = '1500';
            radio1500.style.marginRight = '4px';
            radioLabel1500.append(radio1500, document.createTextNode('1500m'));
            const radioLabel2500 = document.createElement('label');
            radioLabel2500.style.cursor = 'pointer';
            const radio2500 = document.createElement('input');
            radio2500.type = 'radio';
            radio2500.name = 'targetDistanceOption';
            radio2500.value = '2500';
            radio2500.style.marginRight = '4px';
            radioLabel2500.append(radio2500, document.createTextNode('2500m'));
            const radioLabelCustom = document.createElement('label');
            radioLabelCustom.style.cursor = 'pointer';
            const radioCustom = document.createElement('input');
            radioCustom.type = 'radio';
            radioCustom.name = 'targetDistanceOption';
            radioCustom.value = 'custom';
            radioCustom.style.marginRight = '4px';
            radioLabelCustom.append(radioCustom, document.createTextNode('自定义'));
            const customInput = document.createElement('input');
            customInput.type = 'number';
            customInput.min = '1';
            customInput.style.width = '60px';
            customInput.placeholder = '输入距离';
            distDiv.append(distLabel, radioLabel1500, radioLabel2500, radioLabelCustom, customInput);
            settingsContent.appendChild(distDiv);
            // 初始化目标距离单选状态
            if (targetDistance === 1500) {
                radio1500.checked = true;
                customInput.disabled = true;
                customInput.value = '';
            } else if (targetDistance === 2500) {
                radio2500.checked = true;
                customInput.disabled = true;
                customInput.value = '';
            } else {
                radioCustom.checked = true;
                customInput.disabled = false;
                customInput.value = targetDistance;
            }
            // 目标距离选项变化事件
            radio1500.addEventListener('change', () => {
                if (radio1500.checked) {
                    targetDistance = 1500;
                    localStorage.setItem('targetDistance', targetDistance);
                    customInput.disabled = true;
                    customInput.value = '';
                    data.done = false;
                    container.updateData(data);
                }
            });
            radio2500.addEventListener('change', () => {
                if (radio2500.checked) {
                    targetDistance = 2500;
                    localStorage.setItem('targetDistance', targetDistance);
                    customInput.disabled = true;
                    customInput.value = '';
                    data.done = false;
                    container.updateData(data);
                }
            });
            radioCustom.addEventListener('change', () => {
                if (radioCustom.checked) {
                    customInput.disabled = false;
                    if (customInput.value) {
                        let val = parseInt(customInput.value);
                        if (!isNaN(val) && val > 0) {
                            targetDistance = val;
                            localStorage.setItem('targetDistance', targetDistance);
                        }
                    }
                    data.done = false;
                    container.updateData(data);
                }
            });
            // 自定义距离输入框焦点和输入事件
            customInput.addEventListener('focus', () => {
                if (!radioCustom.checked) {
                    radioCustom.checked = true;
                    const event = new Event('change');
                    radioCustom.dispatchEvent(event);
                }
            });
            customInput.addEventListener('input', () => {
                if (radioCustom.checked) {
                    let val = parseInt(customInput.value);
                    if (!isNaN(val) && val > 0) {
                        targetDistance = val;
                        localStorage.setItem('targetDistance', targetDistance);
                        data.done = false;
                        container.updateData(data);
                    }
                }
            });

            // 轮询速度设置
            const pollDiv = document.createElement('div');
            pollDiv.style.display = 'flex';
            pollDiv.style.alignItems = 'center';
            pollDiv.style.gap = '6px';
            const pollLabel = document.createElement('span');
            pollLabel.textContent = '轮询间隔:';
            const pollValueText = document.createElement('span');
            pollValueText.textContent = pollInterval + 'ms';
            const pollSlider = document.createElement('input');
            pollSlider.type = 'range';
            pollSlider.min = '100';
            pollSlider.max = '5000';
            pollSlider.step = '100';
            pollSlider.value = pollInterval;
            pollSlider.style.flex = '1';
            pollDiv.append(pollLabel, pollSlider, pollValueText);
            settingsContent.appendChild(pollDiv);
            pollSlider.addEventListener('input', () => {
                pollValueText.textContent = pollSlider.value + 'ms';
            });
            pollSlider.addEventListener('change', () => {
                pollInterval = parseInt(pollSlider.value);
                if (isNaN(pollInterval) || pollInterval < 100) pollInterval = 100;
                localStorage.setItem('pollInterval', pollInterval);
                if (pollIntervalId) {
                    clearInterval(pollIntervalId);
                    pollIntervalId = setInterval(() => {
                        poll(currentSchool, container);
                    }, pollInterval);
                }
            });

            // 恢复默认值按钮
            const resetButton = document.createElement('button');
            resetButton.textContent = '恢复默认值';
            Object.assign(resetButton.style, {
                backgroundColor: '#f44336',
                color: '#fff',
                padding: '6px 12px',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                alignSelf: 'flex-start'
            });
            settingsContent.appendChild(resetButton);
            resetButton.addEventListener('click', () => {
                // 重置变量为默认
                soundEnabled = defaultSoundEnabled;
                vibrateEnabled = defaultVibrateEnabled;
                voiceEnabled = defaultVoiceEnabled;
                targetDistance = defaultTargetDistance;
                pollInterval = defaultPollInterval;
                // 保存到 localStorage
                localStorage.setItem('soundEnabled', JSON.stringify(soundEnabled));
                localStorage.setItem('vibrateEnabled', JSON.stringify(vibrateEnabled));
                localStorage.setItem('voiceEnabled', JSON.stringify(voiceEnabled));
                localStorage.setItem('targetDistance', targetDistance);
                localStorage.setItem('pollInterval', pollInterval);
                // 更新UI控件状态
                soundCheckbox.checked = soundEnabled;
                vibrateCheckbox.checked = vibrateEnabled;
                voiceCheckbox.checked = voiceEnabled;
                radio1500.checked = (targetDistance === 1500);
                radio2500.checked = (targetDistance === 2500);
                radioCustom.checked = !(radio1500.checked || radio2500.checked);
                if (radioCustom.checked) {
                    customInput.disabled = false;
                    customInput.value = targetDistance;
                } else {
                    customInput.disabled = true;
                    customInput.value = '';
                }
                pollSlider.value = pollInterval;
                pollValueText.textContent = pollInterval + 'ms';
                // 即时应用默认设置
                data.done = false;
                container.updateData(data);
                if (pollIntervalId) {
                    clearInterval(pollIntervalId);
                    pollIntervalId = setInterval(() => {
                        poll(currentSchool, container);
                    }, pollInterval);
                }
            });

            // 将选项卡和两个子页面添加到容器
            container.append(tabBar, statsContent, settingsContent);

            // 数据行创建函数
            function createStatRow(label, value, field) {
                const row = document.createElement('div');
                row.style.display = 'flex';
                row.style.justifyContent = 'space-between';
                row.style.gap = '20px';
                const labelElem = document.createElement('span');
                labelElem.textContent = label;
                labelElem.style.opacity = '0.8';
                const valueElem = document.createElement('span');
                valueElem.textContent = value;
                valueElem.style.fontWeight = '30';
                elements[field] = valueElem;
                row.append(labelElem, valueElem);
                return row;
            }

            // 数据更新方法（刷新UI显示）
            container.updateData = function (newData) {
                if (newData.startTime) elements.startTime.textContent = newData.startTime;
                if (newData.endTime) elements.endTime.textContent = newData.endTime;
                if (newData.effectiveDistance !== undefined) {
                    elements.effectiveDistance.textContent = `${newData.effectiveDistance}m`;
                }
                if (newData.usedTime !== undefined) {
                    elements.usedTime.textContent = `${newData.usedTime}`;
                }
                if (newData.speed !== undefined) {
                    elements.speed.textContent = formatPace(newData.speed);
                }
                if (newData.ineffectiveDistance !== undefined) {
                    elements.ineffectiveDistance.textContent = `${newData.ineffectiveDistance}m`;
                }
                if (newData.effectiveDistance !== undefined) {
                    const progress = Math.min(newData.effectiveDistance / targetDistance, 1);
                    const percentage = (progress * 100).toFixed(1);
                    elements.progressBar.style.width = `${percentage}%`;
                    elements.progressText.textContent = `${newData.effectiveDistance}m / ${targetDistance}m (${percentage}%)`;
                    if (enable_dark_mode) {
                        elements.progressText.style.color = '#ffffff';
                    } else {
                        elements.progressText.style.color = progress > 0.5 ? '#fff' : '#333';//TODO 进度条字体颜色修正
                    }
                }
                if (newData.effectiveDistance !== undefined && newData.speed !== undefined) {
                    if (newData.effectiveDistance < targetDistance) {
                        elements.RemainingTime.textContent = calculateRemainingTime({ averagePace: newData.speed, effectiveDistance: newData.effectiveDistance }, targetDistance)
                    } else {
                        elements.RemainingTime.textContent = '0:00'
                    }
                }
            };

            // 容器显示/隐藏控制
            container.show = function () {
                this.style.display = 'flex';
                void this.offsetHeight;
                this.style.opacity = '1';
            };
            container.hide = function () {
                this.style.opacity = '0';
                setTimeout(() => { this.style.display = 'none'; }, 300);
            };
            container.toggle = function () {
                this.style.display === 'none' ? this.show() : this.hide();
            };

            // 初始化进度条显示
            container.updateData(initialData);
            return container;
        }

        // 初始化组件
        const runData = { startTime: "00:00", endTime: "00:00", usedTime: "00:00", effectiveDistance: 0, speed: 0, ineffectiveDistance: 0 };
        const statsComponent = createRunStatsComponent(runData);
        document.body.appendChild(statsComponent);

        // 获取学校信息并启动后续流程
        getSchool().then(sch => {
            currentSchool = sch;

            // 创建控制按钮（刷新按钮和显示/隐藏按钮）
            const createControlButtons = () => {
                const faLink = document.createElement('link');
                faLink.rel = 'stylesheet';
                faLink.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css';
                document.head.appendChild(faLink);
                const btnContainer = document.createElement('div');
                Object.assign(btnContainer.style, {
                    position: 'fixed',
                    bottom: '20px',
                    right: '20px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px',
                    zIndex: '10000',
                    filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.2))'
                });
                const createIconButton = (iconClass, clickHandler, bgColor = '#4CAF50') => {
                    const btn = document.createElement('button');
                    Object.assign(btn.style, {
                        width: '40px',
                        height: '40px',
                        borderRadius: '50%',
                        border: 'none',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: bgColor,
                        color: 'white',
                        transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                        fontSize: '16px',
                        padding: '0'
                    });
                    const icon = document.createElement('i');
                    icon.className = `fa-solid ${iconClass}`;
                    btn.appendChild(icon);
                    btn.addEventListener('mouseenter', () => { btn.style.transform = 'scale(1.1)'; });
                    btn.addEventListener('mouseleave', () => { btn.style.transform = 'scale(1)'; });
                    btn.addEventListener('mousedown', () => { btn.style.transform = 'scale(0.9)'; });
                    btn.addEventListener('mouseup', () => { btn.style.transform = 'scale(1.1)'; });
                    btn.addEventListener('click', (e) => {
                        e.preventDefault();
                        setTimeout(() => { btn.style.transform = 'scale(1)'; }, 150);
                        clickHandler();
                    });
                    return btn;
                };
                const buttons = [
                    { icon: 'fa-arrows-rotate', action: () => poll(currentSchool, statsComponent), color: '#4CAF50' },
                    { icon: 'fa-eye', action: () => statsComponent.toggle(), color: '#2196F3' }
                ];
                buttons.forEach(config => {
                    btnContainer.appendChild(createIconButton(config.icon, config.action, config.color));
                });
                document.body.appendChild(btnContainer);
            };
            createControlButtons();

            // 创建“Start”按钮以启用AudioContext
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (!AudioContext) return;
            const audioCtx = new AudioContext();
            const enableAudioButton = document.createElement("button");
            enableAudioButton.textContent = "Start";
            enableAudioButton.style.position = "fixed";
            enableAudioButton.style.bottom = "20px";
            enableAudioButton.style.left = "50%";
            enableAudioButton.style.transform = "translateX(-50%)";
            enableAudioButton.style.zIndex = "10000";
            enableAudioButton.style.padding = "10px";
            enableAudioButton.style.backgroundColor = "#4CAF50";
            enableAudioButton.style.color = "#fff";
            enableAudioButton.style.border = "none";
            enableAudioButton.style.borderRadius = "5px";
            enableAudioButton.style.cursor = "pointer";
            document.body.appendChild(enableAudioButton);
            $('.start-btn')[0].style.display = "none";

            // 点击Start按钮，恢复音频上下文并开始轮询
            enableAudioButton.addEventListener("click", function () {
                //const start = document.getElementsByClassName("start-btn")[0];
                try{
                    $('.start-btn')[0].click();
                }catch(e){
                    console.log(e);
                }
                if (audioCtx.state === "suspended") {
                    audioCtx.resume().then(() => {
                        console.log("AudioContext resumed");
                        enableAudioButton.style.display = "none";
                        if (soundEnabled) startRunTone();
                        if (vibrateEnabled) navigator.vibrate([200, 100, 300]);
                        poll(currentSchool, statsComponent);
                        pollIntervalId = setInterval(() => {
                            poll(currentSchool, statsComponent);
                        }, pollInterval);
                    }).catch((err) => {
                        console.error("Error resuming AudioContext:", err);
                    });
                } else {
                    enableAudioButton.style.display = "none";
                }
            });
        });
    });
})();
