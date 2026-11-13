# SmartImageStitcher

智能图片排序与无缝拼接工具 — 纯浏览器端，无需后端服务器。

## 🌟 功能特性

- **智能排序**: 使用 ORB 特征提取自动分析图片内容，推断正确顺序
- **重叠去重**: 自动检测相邻图片的重叠区域并去除重复内容
- **黑边清理**: 自动识别并去除截图产生的黑色横条
- **自动对齐**: 基于 RANSAC 算法计算图片最佳对齐位置
- **手动调整**: 支持拖拽排序，支持锁定图片位置
- **长图预览**: 实时预览拼接效果，支持缩放
- **多格式导出**: 支持 PNG、JPG、WEBP 格式导出

## 🚀 在线访问

访问 GitHub Pages: https://[用户名].github.io/smart-image-stitcher/

## 💻 本地运行

```bash
cd smart-image-stitcher
npm install
npm run dev
```

## 🛠 技术栈

- **前端框架**: Vue 3 + TypeScript + Vite
- **图像处理**: OpenCV.js (ORB特征提取、RANSAC对齐)
- **状态管理**: Pinia
- **部署**: GitHub Pages via GitHub Actions
