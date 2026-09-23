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
} from 'ckeditor5';
import type { Editor } from 'ckeditor5';
import viTranslations from 'ckeditor5/translations/vi.js';
import 'ckeditor5/ckeditor5.css';
import { useAuth } from '@/context/AuthContext';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api/v1';
const MAX_IMAGE_BYTES = 25 * 1024 * 1024; // same limit as the API

// The server only keeps: p, br, strong/b, em/i, u, s, h2-h4, ul/ol/li, blockquote, a, hr,
// figure/figcaption and <img> of files uploaded to this site (backend/src/utils/richText.ts).
// Keep the toolbar within that set.
export interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  /** Minimum editable height in px */
  minHeight?: number;
}

export default function RichTextEditorImpl({ value, onChange, placeholder, minHeight = 160 }: RichTextEditorProps) {
  const editorRef = useRef<any>(null);
  const { authFetch } = useAuth();
  // The editor is configured once; keep a ref so uploads always use the latest auth state
  const authFetchRef = useRef(authFetch);
  authFetchRef.current = authFetch;

  // Sends pasted / dropped / chosen images to POST /upload/image and returns the stored URL
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

  // Parent reset/async load (e.g. edit form fetched later): push the new value into the editor
  useEffect(() => {
    const editor = editorRef.current;
    if (editor && value !== editor.getData()) {
      editor.setData(value || '');
    }
  }, [value]);

  return (
    <div className="novel-ck" style={{ ['--novel-ck-min-height' as any]: `${minHeight}px` }}>
      <CKEditor
        editor={ClassicEditor}
        data={value || ''}
        config={{
          licenseKey: 'GPL',
          translations: [viTranslations],
          language: 'vi',
          placeholder,
          plugins: [
            Essentials, Paragraph, Heading, Bold, Italic, Underline, Strikethrough, Link, AutoLink, List, BlockQuote, HorizontalLine,
            Image, ImageCaption, ImageResize, ImageStyle, ImageTextAlternative, ImageToolbar, ImageUpload,
          ],
          extraPlugins: [uploadAdapterPlugin],
          toolbar: {
            items: [
              'undo', 'redo', '|',
              'heading', '|',
              'bold', 'italic', 'underline', 'strikethrough', '|',
              'link', 'bulletedList', 'numberedList', 'blockQuote', 'horizontalLine', '|',
              'uploadImage',
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
          link: {
            addTargetToExternalLinks: true,
            defaultProtocol: 'https://',
          },
        }}
        onReady={(editor) => {
          editorRef.current = editor;
        }}
        onChange={(_event, editor) => {
          onChange(editor.getData());
        }}
      />
    </div>
  );
}
