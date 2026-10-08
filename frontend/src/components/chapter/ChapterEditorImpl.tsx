'use client';

import React, { useEffect, useMemo, useRef } from 'react';
import { CKEditor } from '@ckeditor/ckeditor5-react';
import {
  ClassicEditor,
  Essentials,
  Paragraph,
  Heading,
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Superscript,
  Subscript,
  FontSize,
  Highlight,
  Alignment,
  RemoveFormat,
  Link,
  AutoLink,
  List,
  BlockQuote,
  HorizontalLine,
  Image,
  ImageCaption,
  ImageResize,
  ImageStyle,
  ImageTextAlternative,
  ImageToolbar,
  ImageUpload,
  SpecialCharacters,
  SpecialCharactersEssentials,
  FindAndReplace,
  WordCount,
  Autoformat,
  TextTransformation,
  PasteFromOffice,
  Fullscreen,
  Table,
  TableToolbar,
} from 'ckeditor5';
import type { Editor } from 'ckeditor5';
import viTranslations from 'ckeditor5/translations/vi.js';
import 'ckeditor5/ckeditor5.css';
import { useAuth } from '@/context/AuthContext';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api/v1';
const MAX_IMAGE_BYTES = 25 * 1024 * 1024; // same limit as the API

// Everything below is expressed as classes (alignment, font size, highlight) so the reader can restyle
// it per theme; the API keeps exactly these (sanitizeChapterHtml in backend/src/utils/richText.ts).
export interface ChapterEditorProps {
  value: string;
  onChange: (html: string) => void;
  onStats?: (stats: { words: number; characters: number }) => void;
  placeholder?: string;
}

// Punctuation translators keep reaching for: Japanese brackets, dashes, ellipsis, music / star marks
const STORY_CHARACTERS = [
  ['Ngoặc kép Nhật', '「'], ['Đóng ngoặc kép Nhật', '」'], ['Ngoặc kép đôi Nhật', '『'], ['Đóng ngoặc kép đôi Nhật', '』'],
  ['Ngoặc tên sách', '《'], ['Đóng ngoặc tên sách', '》'], ['Ngoặc nhọn', '〈'], ['Đóng ngoặc nhọn', '〉'],
  ['Ngoặc kép mở', '“'], ['Ngoặc kép đóng', '”'], ['Ngoặc đơn mở', '‘'], ['Ngoặc đơn đóng', '’'],
  ['Ba chấm', '…'], ['Gạch dài', '—'], ['Gạch ngắn', '–'], ['Chấm giữa', '・'], ['Dấu sóng', '〜'],
  ['Nốt nhạc', '♪'], ['Hai nốt nhạc', '♫'], ['Sao đặc', '★'], ['Sao rỗng', '☆'], ['Tim', '♥'], ['Tim rỗng', '♡'],
  ['Dấu lưu ý', '※'], ['Mũi tên phải', '→'], ['Mũi tên trái', '←'], ['Hình thoi', '◆'], ['Hình thoi rỗng', '◇'],
].map(([title, character]) => ({ title, character }));

function StoryCharacters(editor: Editor) {
  editor.plugins.get('SpecialCharacters').addItems('Truyện', STORY_CHARACTERS, { label: 'Ký tự truyện' });
}

export default function ChapterEditorImpl({ value, onChange, onStats, placeholder }: ChapterEditorProps) {
  const editorRef = useRef<any>(null);
  const { authFetch } = useAuth();
  const authFetchRef = useRef(authFetch);
  authFetchRef.current = authFetch;
  const onStatsRef = useRef(onStats);
  onStatsRef.current = onStats;

  // Pasted / dropped / chosen illustrations go to POST /upload/image
  const uploadAdapterPlugin = useMemo(() => {
    return function UploadAdapterPlugin(editor: Editor) {
      editor.plugins.get('FileRepository').createUploadAdapter = (loader: any) => ({
        upload: async () => {
          const file: File = await loader.file;
          if (file.size > MAX_IMAGE_BYTES) throw new Error('Ảnh vượt quá 25MB.');
          const body = new FormData();
          body.append('image', file);
          const res = await authFetchRef.current(`${API_BASE_URL}/upload/image`, { method: 'POST', body });
          const json = await res.json().catch(() => ({}));
          if (!res.ok || !json.success) throw new Error(json.message || 'Tải ảnh lên thất bại.');
          return { default: json.data.url };
        },
        abort: () => {},
      });
    };
  }, []);

  // A value loaded later (edit form, restored draft) is pushed into the editor
  useEffect(() => {
    const editor = editorRef.current;
    if (editor && value !== editor.getData()) editor.setData(value || '');
  }, [value]);

  return (
    <div className="novel-ck chapter-ck" style={{ ['--novel-ck-min-height' as any]: '420px' }}>
      <CKEditor
        editor={ClassicEditor}
        data={value || ''}
        config={{
          licenseKey: 'GPL',
          translations: [viTranslations],
          language: 'vi',
          placeholder,
          plugins: [
            Essentials, Paragraph, Heading, Bold, Italic, Underline, Strikethrough, Superscript, Subscript,
            FontSize, Highlight, Alignment, RemoveFormat, Link, AutoLink, List, BlockQuote, HorizontalLine,
            Image, ImageCaption, ImageResize, ImageStyle, ImageTextAlternative, ImageToolbar, ImageUpload,
            SpecialCharacters, SpecialCharactersEssentials, FindAndReplace, WordCount, Autoformat, TextTransformation,
            PasteFromOffice, Fullscreen, Table, TableToolbar,
          ],
          extraPlugins: [uploadAdapterPlugin, StoryCharacters],
          toolbar: {
            items: [
              'undo', 'redo', '|',
              'heading', 'fontSize', '|',
              'bold', 'italic', 'underline', 'strikethrough', 'superscript', 'subscript', 'highlight', 'removeFormat', '|',
              'alignment', '|',
              'blockQuote', 'horizontalLine', 'bulletedList', 'numberedList', 'insertTable', 'link', '|',
              'uploadImage', 'specialCharacters', '|',
              'findAndReplace', 'fullscreen',
            ],
            shouldNotGroupWhenFull: false,
          },
          heading: {
            options: [
              { model: 'paragraph', title: 'Đoạn văn', class: 'ck-heading_paragraph' },
              { model: 'heading2', view: 'h2', title: 'Tiêu đề lớn', class: 'ck-heading_heading2' },
              { model: 'heading3', view: 'h3', title: 'Tiêu đề vừa', class: 'ck-heading_heading3' },
              { model: 'heading4', view: 'h4', title: 'Tiêu đề nhỏ', class: 'ck-heading_heading4' },
            ],
          },
          // named sizes -> <span class="text-big"> etc.; relative to the reader's own font size
          fontSize: { options: ['tiny', 'small', 'default', 'big', 'huge'] },
          alignment: {
            options: [
              { name: 'left', className: 'nh-align-left' },
              { name: 'center', className: 'nh-align-center' },
              { name: 'right', className: 'nh-align-right' },
              { name: 'justify', className: 'nh-align-justify' },
            ],
          },
          image: {
            toolbar: ['toggleImageCaption', 'imageTextAlternative', '|', 'resizeImage'],
            resizeUnit: '%',
            resizeOptions: [
              { name: 'resizeImage:original', value: null, label: 'Cỡ gốc' },
              { name: 'resizeImage:75', value: '75', label: '75%' },
              { name: 'resizeImage:50', value: '50', label: '50%' },
              { name: 'resizeImage:25', value: '25', label: '25%' },
            ],
          },
          link: { addTargetToExternalLinks: true, defaultProtocol: 'https://' },
          // status windows, item / skill lists...
          table: { contentToolbar: ['tableColumn', 'tableRow', 'mergeTableCells'] },
          wordCount: {
            onUpdate: (stats: { words: number; characters: number }) => onStatsRef.current?.(stats),
          },
        }}
        onReady={(editor) => {
          editorRef.current = editor;
        }}
        onChange={(_event, editor) => onChange(editor.getData())}
      />
    </div>
  );
}
